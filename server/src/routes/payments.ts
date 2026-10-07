import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getCommissionPercent } from '../utils/config';

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

// List Nigerian banks (NIP codes) for driver payout onboarding.
router.get('/banks', requireAuth(), async (_req, res) => {
  try {
    const result = await paystackRequest('/bank?currency=NGN&country=nigeria&type=nip_bank');
    const banks = (result.data as any[] || []).map((bank: any) => ({
      name: bank.name,
      code: bank.code,
    }));
    res.json({ banks });
  } catch (error: any) {
    console.error('Paystack bank list error:', error);
    res.status(502).json({ error: error?.message || 'Could not load the bank list' });
  }
});

// Resolve a bank account number to its holder name so drivers can confirm
// the payout account before it is saved.
router.post('/banks/resolve', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const accountNumber = String(req.body?.accountNumber || '').replace(/\s+/g, '');
    const bankCode = String(req.body?.bankCode || '');

    if (!/^\d{10}$/.test(accountNumber) || !bankCode) {
      return res.status(400).json({ error: 'A 10-digit account number and bank are required' });
    }

    const result = await paystackRequest(
      '/bank/resolve?account_number=' + encodeURIComponent(accountNumber) + '&bank_code=' + encodeURIComponent(bankCode)
    );
    const data = result.data as any;
    res.json({ accountName: data?.account_name || '', accountNumber, bankCode });
  } catch (error: any) {
    console.error('Paystack bank resolve error:', error);
    res.status(502).json({ error: error?.message || 'Could not verify that bank account' });
  }
});

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
    // Paystack does not append the reference to the callback URL, so it has to
    // be carried explicitly. Without it the frontend has nothing to verify.
    const callbackUrl =
      getFrontendOrigin() +
      '/trips/' + encodeURIComponent(ride.id) +
      '?payment=paystack&reference=' + encodeURIComponent(reference);

    // Split payments: if the completed ride has a driver with a verified
    // Paystack subaccount, route the driver's share directly to their bank
    // and keep the platform commission. Otherwise the full fare settles to
    // the platform account.
    const driver = ride.driverId
      ? await prisma.driver.findUnique({ where: { id: ride.driverId } })
      : null;

    const splitBody: Record<string, unknown> = {
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
    };

    if (driver?.payoutSubaccountCode) {
      // Percentage split: the driver's subaccount receives
      // (100 - commission)% and the platform account keeps the commission.
      const commissionPercent = getCommissionPercent();
      splitBody.split = {
        type: 'percentage',
        bearer_type: 'all',
        subaccounts: [
          {
            subaccount: driver.payoutSubaccountCode,
            share: 100 - commissionPercent,
          },
        ],
      };
    }

    const result = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify(splitBody),
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
      const paidRide = await prisma.ride.findUnique({ where: { id: payment.rideId } });
      return res.json({ paid: true, payment, ride: paidRide });
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

// Paystack webhook: authoritative payment confirmation. Marks the payment and
// ride paid even if the passenger closes the tab before the redirect. The raw
// body is required for HMAC signature verification, so this route must be
// mounted with express.raw (see server/src/index.ts).
router.post('/paystack/webhook', (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;

  if (!secret) {
    return res.status(503).json({ error: 'Paystack is not configured' });
  }

  const signature = req.headers['x-paystack-signature'];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));

  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  if (!signature || typeof signature !== 'string' || !timingSafeEqualHex(expected, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  // Acknowledge quickly; process asynchronously so Paystack does not time out.
  res.json({ received: true });

  if (event?.event !== 'charge.success') return;

  const transaction = event.data || {};
  const reference = String(transaction.reference || '');

  (async () => {
    try {
      const payment = await prisma.payment.findFirst({ where: { reference } });
      if (!payment || payment.status === 'Paid') return;

      const ride = await prisma.ride.findUnique({ where: { id: payment.rideId } });
      if (!ride) return;

      const expectedKobo = Math.round(Number(ride.amount || 0) * 100);
      if (Number(transaction.amount) !== expectedKobo || String(transaction.currency || '').toUpperCase() !== 'NGN') {
        return;
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'Paid',
          paidAt: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
          channel: transaction.channel || null,
          transactionId: String(transaction.id),
        },
      });

      await prisma.ride.update({
        where: { id: ride.id },
        data: {
          paymentMethod: 'Paystack',
          paymentStatus: 'Paid',
          paymentReference: reference,
        },
      });
    } catch (error) {
      console.error('Paystack webhook processing error:', error);
    }
  })();
});

function timingSafeEqualHex(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default router;
