import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../utils/database';
import { requireAuth, requireDriver, AuthenticatedRequest } from '../middleware/auth';
import { getCommissionPercent } from '../utils/config';

const router = Router();

type PaystackResponse = {
  status?: boolean;
  message?: string;
  data?: any;
  meta?: { page?: number; pageCount?: number; total?: number; perPage?: number; next?: string };
};

type PaystackBank = { name: string; code: string; id?: number; slug?: string };

const BANK_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let bankCache: { banks: PaystackBank[]; fetchedAt: number } | null = null;

async function fetchNigerianBanks(): Promise<PaystackBank[]> {
  const allBanks: PaystackBank[] = [];
  let page = 1;
  let pageCount = 1;

  // Paystack's List Banks endpoint uses page/perPage pagination. The `type=nip_bank`
  // filter is not a general Nigerian-bank filter and can cause the request to fail.
  do {
    const result = await paystackRequest(
      '/bank?country=nigeria&currency=NGN&perPage=100&page=' + page
    );
    const pageBanks = Array.isArray(result.data) ? result.data : [];
    allBanks.push(...pageBanks);
    pageCount = Number(result.meta?.pageCount || (pageBanks.length === 100 ? page + 1 : page));
    page += 1;
  } while (page <= pageCount && page <= 20);

  const unique = new Map<string, PaystackBank>();
  for (const bank of allBanks) {
    const name = String(bank?.name || '').trim();
    const code = String(bank?.code || '').trim();
    if (name && code) unique.set(code, { name, code });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

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

 // Atomically apply a confirmed Paystack charge to one pending payment and its ride.
 // The ride-level guard prevents two distinct references from paying the same ride.
async function settleVerifiedPayment(paymentId: string, reference: string, transaction: any) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.reference !== reference) {
      throw new Error('Payment reference does not match the payment record');
    }

    const ride = await tx.ride.findUnique({ where: { id: payment.rideId } });
    if (!ride || ride.passengerId !== payment.userId) {
      throw new Error('Payment is not linked to a valid passenger ride');
    }

    if (
      transaction?.status !== 'success' ||
      String(transaction?.reference || '') !== reference ||
      !transaction?.id ||
      Number(transaction?.amount) !== payment.amount * 100 ||
      payment.amount !== ride.amount ||
      String(transaction?.currency || '').toUpperCase() !== 'NGN'
    ) {
      throw new Error('Paystack transaction details do not match the expected payment');
    }

    if (payment.status === 'Paid') {
      if (ride.paymentStatus !== 'Paid' || ride.paymentReference !== reference) {
        throw new Error('Payment record and ride payment state do not match');
      }
      return { paid: true, payment, ride };
    }

    if (payment.status !== 'Pending') {
      throw new Error('This payment is no longer pending');
    }
    if (ride.paymentStatus === 'Paid') {
      throw new Error('This ride has already been paid for with another reference');
    }

    const paymentClaim = await tx.payment.updateMany({
      where: { id: payment.id, status: 'Pending' },
      data: {
        status: 'Paid',
        paidAt: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
        channel: transaction.channel || null,
        transactionId: String(transaction.id),
      },
    });

    if (paymentClaim.count !== 1) {
      const latestPayment = await tx.payment.findUnique({ where: { id: payment.id } });
      const latestRide = await tx.ride.findUnique({ where: { id: ride.id } });
      if (latestPayment?.status === 'Paid' && latestRide?.paymentStatus === 'Paid' && latestRide.paymentReference === reference) {
        return { paid: true, payment: latestPayment, ride: latestRide };
      }
      throw new Error('Payment changed while it was being verified');
    }

    const rideClaim = await tx.ride.updateMany({
      where: { id: ride.id, paymentStatus: { not: 'Paid' } },
      data: {
        paymentMethod: 'Paystack',
        paymentStatus: 'Paid',
        paymentReference: reference,
      },
    });

    if (rideClaim.count !== 1) {
      throw new Error('This ride has already been paid for with another reference');
    }

    const [updatedPayment, updatedRide] = await Promise.all([
      tx.payment.findUnique({ where: { id: payment.id } }),
      tx.ride.findUnique({ where: { id: ride.id } }),
    ]);
    if (!updatedPayment || !updatedRide) throw new Error('Unable to confirm the saved payment state');
    return { paid: true, payment: updatedPayment, ride: updatedRide };
  });
}


// List Nigerian banks for driver payout onboarding. Cache the list to avoid
// calling Paystack on every profile visit, but fall back to a stale successful
// response if Paystack is temporarily unavailable.
router.get('/banks', requireAuth(), async (_req, res) => {
  const cacheIsFresh = bankCache && Date.now() - bankCache.fetchedAt < BANK_CACHE_TTL_MS;
  if (cacheIsFresh) {
    return res.json({ banks: bankCache!.banks, cached: true, stale: false });
  }

  try {
    const banks = await fetchNigerianBanks();
    if (!banks.length) throw new Error('Paystack returned an empty bank list');
    bankCache = { banks, fetchedAt: Date.now() };
    return res.json({ banks, cached: false, stale: false });
  } catch (error: any) {
    console.error('Paystack bank list error:', error?.message || error);
    if (bankCache?.banks.length) {
      return res.json({ banks: bankCache.banks, cached: true, stale: true });
    }
    return res.status(502).json({ error: 'Paystack could not load the bank list. Please retry in a moment.' });
  }
});

// Resolve a bank account number to its holder name so drivers can confirm
// the payout account before it is saved.
router.post('/banks/resolve', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
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
    if (req.user!.role !== 'passenger') {
      return res.status(403).json({ error: 'Only passenger accounts can pay for rides' });
    }

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
    if (req.user!.role !== 'passenger') {
      return res.status(403).json({ error: 'Only passenger accounts can verify ride payments' });
    }

    const reference = String(req.query.reference || '').trim();
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });

    const payment = await prisma.payment.findFirst({
      where: { reference, userId: req.user!.userId },
    });
    if (!payment) return res.status(404).json({ error: 'Payment record not found' });

    const ride = await prisma.ride.findUnique({ where: { id: payment.rideId } });
    if (!ride || ride.passengerId !== req.user!.userId) {
      return res.status(403).json({ error: 'Payment ride is not authorized' });
    }

    if (payment.status === 'Paid') {
      if (ride.paymentStatus === 'Paid' && ride.paymentReference === reference) {
        return res.json({ paid: true, payment, ride });
      }
      return res.status(409).json({ error: 'Payment and ride records need reconciliation' });
    }
    if (ride.status !== 'Completed') {
      return res.status(409).json({ error: 'Only completed rides can be paid for' });
    }

    const result = await paystackRequest('/transaction/verify/' + encodeURIComponent(reference));
    const transaction = result.data || {};
    if (
      transaction?.status !== 'success' ||
      String(transaction?.reference || '') !== reference ||
      Number(transaction?.amount) !== payment.amount * 100 ||
      payment.amount !== ride.amount ||
      String(transaction?.currency || '').toUpperCase() !== 'NGN'
    ) {
      return res.json({ paid: false, status: transaction?.status || 'unknown' });
    }

    const settled = await settleVerifiedPayment(payment.id, reference, transaction);
    res.json(settled);
  } catch (error: any) {
    console.error('Paystack verification error:', error);
    const message = error?.message || 'Unable to verify the online payment';
    const status = /already been paid|no longer pending|changed while|do not match|reconciliation/i.test(message) ? 409 : 502;
    res.status(status).json({ error: message });
  }
});

// Paystack webhook: authoritative payment confirmation. Process the event before
// acknowledging it so transient database failures receive a retry from Paystack.
// The raw body is required for HMAC signature verification (see server/src/index.ts).
router.post('/paystack/webhook', async (req, res) => {
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

  // Other valid Paystack events are acknowledged but do not change ride state.
  if (event?.event !== 'charge.success') {
    return res.json({ received: true });
  }

  const transaction = event.data || {};
  const reference = String(transaction.reference || '').trim();
  if (!reference || String(transaction?.reference || '') !== reference || transaction?.status !== 'success') {
    return res.status(400).json({ error: 'Invalid successful transaction payload' });
  }

  try {
    const payment = await prisma.payment.findUnique({ where: { reference } });
    // The payment row may not have committed yet if the webhook arrives immediately
    // after initialization. Return a retryable error instead of silently losing it.
    if (!payment) {
      return res.status(503).json({ error: 'Payment record is not available yet; retry this webhook' });
    }

    await settleVerifiedPayment(payment.id, reference, transaction);
    return res.json({ received: true });
  } catch (error: any) {
    console.error('Paystack webhook processing error:', error);
    const message = error?.message || 'Payment webhook processing failed';
    const permanentMismatch = /does not match|not linked to a valid passenger ride|already been paid for with another reference|no longer pending|payment record and ride payment state do not match/i.test(message);
    return res.status(permanentMismatch ? 400 : 500).json({ error: message });
  }
});

function timingSafeEqualHex(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default router;
