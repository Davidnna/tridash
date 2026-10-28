import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { ensureRuntimeSchema } from './utils/payment-schema';
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

// Support one or more frontend origins. FRONTEND_URL remains compatible with
// the existing Render setting; FRONTEND_URLS can contain comma-separated
// additional origins.
const allowedOrigins = [
  process.env.FRONTEND_URL || '',
  process.env.FRONTEND_URLS || '',
]
  .flatMap((value) => value.split(','))
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  allowedOrigins.push('http://localhost:5173');
}

const corsOptions: cors.CorsOptions = {
  origin: allowedOrigins,
  credentials: true,
};

const io = new Server(httpServer, {
  cors: corsOptions,
});

// Middleware
app.use(cors(corsOptions));
// Paystack webhook needs the raw body for HMAC signature verification, so it
// is mounted before express.json().
app.use('/api/payments/paystack/webhook', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

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
ensureRuntimeSchema()
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
