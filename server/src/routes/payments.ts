import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

type PaystackTransaction = {
  status?: string;
  amount?: number | string;
  currency?: string;
  paid_at?: string;
  channel?: string;
  id?: string | number;
};

type PaystackResponse = {
  status?: boolean;
  message?: string;
  data?: { authorization_url?: string } & PaystackTransaction;
};

async function paystackRequest(path: string, options: RequestInit = {}): Promise<PaystackResponse> {
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    throw new Error('Paystack is not configured');
  }

  const response = await fetch('https://api.paystack.co' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const data = await response.json() as PaystackResponse;

  if (!response.ok || !data?.status) {
    throw new Error(data?.message || 'Paystack request failed');
  }

  return data;
}

function getRequestOrigin(req: any): string {
  const forwarded = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return host ? String(forwarded).split(',')[0] + '://' + host : 'http://localhost:3001';
}

// Paystack redirects the payer's browser here after checkout. In production the
// callback must land on the frontend origin (FRONTEND_URL), not the backend
// host that serves this API.
function getFrontendOrigin(): string {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

// Initialize Paystack payment
router.post('/paystack/initialize', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const { rideId } = req.body;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
    });

    if (!ride || ride.passengerId !== req.user!.userId) {
      return res.status(403).json({ error: 'Payment is not authorized for this ride' });
    }

    if (ride.status !== 'Completed') {
      return res.status(409).json({ error: 'Online payment is available after the trip is completed' });
    }

    if (ride.paymentStatus === 'Paid') {
      return res.status(409).json({ error: 'This ride has already been paid for' });
    }

    const amountNaira = Number(ride.amount || 0);

    if (!Number.isInteger(amountNaira) || amountNaira <= 0) {
      return res.status(400).json({ error: 'Ride fare is invalid' });
    }

    const reference = 'TRIDASH-' + ride.id.replace(/[^A-Za-z0-9.-]/g, '-') + '-' + Date.now();
    const callbackUrl = getFrontendOrigin() + '/trips/' + encodeURIComponent(ride.id) + '?payment=paystack';

    const result = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: req.user!.email,
        amount: String(amountNaira * 100), // Convert to kobo
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        channels: ['card', 'bank', 'ussd', 'qr', 'bank_transfer'],
        metadata: {
          rideId: ride.id,
          userId: req.user!.userId,
        },
      }),
    });

    const payment = await prisma.payment.create({
      data: {
        rideId: ride.id,
        userId: req.user!.userId,
        amount: amountNaira,
        method: 'Paystack',
        status: 'Pending',
        reference,
      },
    });

    res.json({
      authorizationUrl: result.data?.authorization_url || '',
      reference,
      payment,
    });
  } catch (error: any) {
    console.error('Paystack initialization error:', error);
    res.status(502).json({ error: error?.message || 'Online payment could not be started. Check the Paystack configuration.' });
  }
});

// Verify Paystack payment
router.get('/paystack/verify', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const reference = String(req.query.reference || '');

    if (!reference) {
      return res.status(400).json({ error: 'Payment reference is required' });
    }

    const payment = await prisma.payment.findFirst({
      where: {
        reference,
        userId: req.user!.userId,
      },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    if (payment.status === 'Paid') {
      return res.json({ paid: true, payment });
    }

    const result = await paystackRequest('/transaction/verify/' + encodeURIComponent(reference));
    const transaction = result.data || {};

    const ride = await prisma.ride.findUnique({
      where: { id: payment.rideId },
    });

    if (!ride || ride.passengerId !== req.user!.userId) {
      return res.status(403).json({ error: 'Payment ride is not authorized' });
    }

    const expectedKobo = Math.round(Number(ride.amount || 0) * 100);

    if (
      transaction?.status !== 'success' ||
      Number(transaction?.amount) !== expectedKobo ||
      String(transaction?.currency || '').toUpperCase() !== 'NGN'
    ) {
      return res.json({ paid: false, status: transaction?.status || 'unknown' });
    }

    // Update payment
    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'Paid',
        paidAt: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
        channel: transaction.channel || null,
        transactionId: String(transaction.id),
      },
    });

    // Update ride
    const updatedRide = await prisma.ride.update({
      where: { id: ride.id },
      data: {
        paymentMethod: 'Paystack',
        paymentStatus: 'Paid',
        paymentReference: reference,
      },
    });

    res.json({
      paid: true,
      payment: updatedPayment,
      ride: updatedRide,
    });
  } catch (error: any) {
    console.error('Paystack verification error:', error);
    res.status(502).json({ error: error?.message || 'Unable to verify the online payment' });
  }
});

export default router;
