import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { initializeFirebase } from './utils/firebase';
import { ensurePaymentCheckoutSchema } from './utils/payment-schema';
import { setupWebSocket } from './services/websocket';

// Import routes
import authRoutes from './routes/auth';
import rideRoutes from './routes/rides';
import driverRoutes from './routes/drivers';
import paymentRoutes from './routes/payments';
import profileRoutes from './routes/profile';
import notificationRoutes from './routes/notifications';
import adminRoutes from './routes/admin';
import mapRoutes from './routes/map';
import incidentRoutes from './routes/incidents';
import ratingRoutes from './routes/ratings';
import tripShareRoutes from './routes/tripShares';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
// Paystack webhook needs the raw body for HMAC signature verification, so it
// is mounted before express.json().
app.use('/api/payments/paystack/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

// Initialize Firebase
initializeFirebase();

// Setup WebSocket
setupWebSocket(io);

// Health check
app.get('/api/_healthcheck', (req, res) => {
  res.json({ message: 'Success', app: 'Tridash' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/driver', driverRoutes); // Some routes use /api/driver
app.use('/api/payments', paymentRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mapbox', mapRoutes);
app.use('/api', mapRoutes); // For /api/route
app.use('/api/incidents', incidentRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/trip-shares', tripShareRoutes);
app.use('/api/shared-trip', tripShareRoutes);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 3001;

// Ensure the Payment table matches the Prisma model before accepting requests.
 // This safely adds the nullable checkout URL column on existing databases,
 // including provider migrations where the schema was not fully migrated.
ensurePaymentCheckoutSchema()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`🚀 Tridash server running on port ${PORT}`);
      console.log(`📡 WebSocket server ready`);
    });
  })
  .catch((error) => {
    console.error('Payment schema preparation failed; refusing to start server:', error);
    process.exit(1);
  });
