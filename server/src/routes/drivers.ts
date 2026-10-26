import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, requireDriver, AuthenticatedRequest } from '../middleware/auth';
import { notifySubscribers } from '../services/websocket';
import { getCommissionPercent } from '../utils/config';
import { randomUUID } from 'crypto';
import { writePrivateDocument, readPrivateDocument, deletePrivateDocument } from '../services/privateDocumentStorage';
import { compareDocumentFields, extractDocumentFields, verifyAgainstOfficialProvider, verifyFaceWithProvider, requiredDocumentTypes, getVerificationConfig, VerificationDocumentType } from '../services/driverVerification';

const router = Router();

// Get all drivers (public). Payout/bank details are excluded so account
// numbers are only ever visible to the driver themselves.
router.get('/', requireAuth(), async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        name: true,
        phone: true,
        tricycle: true,
        rating: true,
        ratingCount: true,
        verified: true,
        online: true,
        status: true,
        documents: true,
        lastLocation: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ drivers });
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ error: 'Failed to get drivers' });
  }
});

// Return the verification requirements configured for the selected operating state.
router.get('/verification-config', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  const state = String(req.query.state || 'Ebonyi').trim().slice(0, 80);
  res.json({ config: getVerificationConfig(state) });
});

// Get current driver profile
router.get('/me', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    let driver = await prisma.driver.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!driver) {
      // Create driver profile if it doesn't exist
      const profile = await prisma.profile.findUnique({
        where: { userId: req.user!.userId },
      });

      driver = await prisma.driver.create({
        data: {
          userId: req.user!.userId,
          name: profile?.name || req.user!.name,
          phone: profile?.phone || '',
          rating: 0,
          verified: false,
          online: false,
          tricycle: '',
          documents: [],
          status: 'pending',
        },
      });
    }

    res.json({ driver });
  } catch (error) {
    console.error('Get driver profile error:', error);
    res.status(500).json({ error: 'Failed to get driver profile' });
  }
});

// Read the current driver's verification application without exposing private storage keys.
router.get('/me/verification', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { userId: req.user!.userId },
      select: {
        id: true, userId: true, name: true, firstName: true, lastName: true, otherNames: true, dateOfBirth: true,
        operatingState: true, operatingArea: true, verificationStatus: true, identityStatus: true, licenseStatus: true, vehicleStatus: true,
        faceStatus: true, phone: true, homeAddress: true, tricycle: true, vehicleMake: true, vehicleModel: true, vehicleColor: true, verified: true, online: true, status: true, createdAt: true, updatedAt: true,
        verificationDocuments: { orderBy: { uploadedAt: 'desc' }, select: {
          id: true, driverId: true, documentType: true, originalName: true, mimeType: true, sizeBytes: true, status: true,
          extractedData: true, automatedChecks: true, providerName: true, providerReference: true, expiryDate: true,
          reviewReason: true, reviewedById: true, reviewedAt: true, uploadedAt: true, verifiedAt: true, createdAt: true, updatedAt: true,
        } },
      },
    });
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    const { verificationDocuments, ...profile } = driver;
    res.json({ driver: profile, documents: verificationDocuments });
  } catch (error) {
    console.error('Driver verification read error:', error);
    res.status(500).json({ error: 'Could not load driver verification' });
  }
});

// Save the driver's structured legal name and state-specific onboarding details.
router.put('/me/verification', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId: req.user!.userId } });
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    const firstName = String(req.body?.firstName || '').trim().slice(0, 80);
    const lastName = String(req.body?.lastName || '').trim().slice(0, 80);
    const otherNames = String(req.body?.otherNames || '').trim().slice(0, 120);
    const phone = String(req.body?.phone || driver.phone || '').trim().slice(0, 40);
    const homeAddress = String(req.body?.homeAddress || '').trim().slice(0, 500);
    const tricycle = String(req.body?.tricycle || '').trim().slice(0, 40).toUpperCase();
    const operatingState = String(req.body?.operatingState || 'Ebonyi').trim().slice(0, 80);
    const operatingArea = String(req.body?.operatingArea || '').trim().slice(0, 120);
    const vehicleMake = String(req.body?.vehicleMake || '').trim().slice(0, 80);
    const vehicleModel = String(req.body?.vehicleModel || '').trim().slice(0, 80);
    const vehicleColor = String(req.body?.vehicleColor || '').trim().slice(0, 40);
    const dateOfBirth = req.body?.dateOfBirth ? new Date(String(req.body.dateOfBirth)) : null;
    if (!firstName || !lastName || !phone || !homeAddress || !tricycle || !vehicleMake || !vehicleModel || !vehicleColor || !operatingState || !operatingArea || !dateOfBirth || Number.isNaN(dateOfBirth.getTime())) {
      return res.status(400).json({ error: 'Complete your name, phone, home address, date of birth, vehicle make, model, colour, registration, operating state and operating area.' });
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number with its country code, such as +2348031234567.' });
    }
    if (dateOfBirth.getTime() >= Date.now()) return res.status(400).json({ error: 'Date of birth must be in the past.' });
    const name = [firstName, otherNames, lastName].filter(Boolean).join(' ');
    const identityChanged = driver.firstName !== firstName || driver.lastName !== lastName || driver.otherNames !== otherNames || driver.tricycle !== tricycle || driver.operatingState !== operatingState || driver.vehicleMake !== vehicleMake || driver.vehicleModel !== vehicleModel || driver.vehicleColor !== vehicleColor || !driver.dateOfBirth || driver.dateOfBirth.toISOString().slice(0, 10) !== dateOfBirth.toISOString().slice(0, 10);
    const updated = await prisma.driver.update({
      where: { id: driver.id },
      data: { firstName, lastName, otherNames, name, phone, homeAddress, tricycle, vehicleMake, vehicleModel, vehicleColor, dateOfBirth, operatingState, operatingArea, verified: identityChanged ? false : driver.verified, online: identityChanged ? false : driver.online, status: identityChanged ? 'pending' : driver.status, verificationStatus: identityChanged ? 'pending_review' : driver.verificationStatus },
    });
    if (identityChanged) {
      await prisma.driverVerificationDocument.updateMany({ where: { driverId: driver.id }, data: { status: 'needs_review', verifiedAt: null, reviewedAt: null, reviewedById: null, reviewReason: 'Driver profile changed; recheck this document against the updated details.' } });
    }
    await prisma.profile.updateMany({ where: { userId: req.user!.userId }, data: { name, phone } });
    res.json({ driver: updated, message: 'Profile saved. Submit the required documents to continue.' });
  } catch (error) {
    console.error('Driver verification profile save error:', error);
    res.status(500).json({ error: 'Could not save driver verification profile' });
  }
});

// Upload a private driver document. Files are not served as public static assets.
router.post('/me/verification/documents', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  let storageKeyForCleanup = '';
  try {
    const driver = await prisma.driver.findUnique({ where: { userId: req.user!.userId } });
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    if (!driver.firstName || !driver.lastName || !driver.dateOfBirth || !driver.tricycle) return res.status(409).json({ error: 'Save your first name, last name, date of birth, and vehicle registration before uploading documents.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Consent to secure document processing is required.' });
    const documentType = String(req.body?.documentType || '') as VerificationDocumentType;
    if (!['government_id', 'drivers_license', 'vehicle_registration', 'state_operating_permit', 'vehicle_inspection_certificate', 'insurance_certificate', 'selfie'].includes(documentType)) {
      return res.status(400).json({ error: 'Choose a supported document type.' });
    }
    const mimeType = String(req.body?.mimeType || '').toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimeType)) {
      return res.status(400).json({ error: 'Upload a PDF, JPG, PNG or WebP file.' });
    }
    if (documentType === 'selfie' && mimeType === 'application/pdf') return res.status(400).json({ error: 'A selfie must be an image file.' });
    const base64 = String(req.body?.base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return res.status(400).json({ error: 'The uploaded file could not be read.' });
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'Each document must be smaller than 8 MB.' });
    const isPdf = buffer.subarray(0, 5).toString() === '%PDF-';
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const isWebp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
    if (!((mimeType === 'application/pdf' && isPdf) || (mimeType === 'image/jpeg' && isJpeg) || (mimeType === 'image/png' && isPng) || (mimeType === 'image/webp' && isWebp))) {
      return res.status(400).json({ error: 'The file contents do not match the selected file type.' });
    }

    const storageKey = randomUUID();
    storageKeyForCleanup = storageKey;
    await writePrivateDocument(storageKey, buffer);

    let extractedFields: Record<string, unknown> | null = null;
    let ocrProvider = '';
    let ocrConfigured = false;
    let comparison: { checks: Record<string, unknown>; status: 'needs_review' | 'checks_passed' };
    let official: Record<string, any> = { configured: false, verified: false, detailsMatch: false, details: null, provider: '', reference: '', message: 'Official verification is not configured.' };
    if (documentType === 'selfie') {
      const identityDoc = await prisma.driverVerificationDocument.findFirst({ where: { driverId: driver.id, documentType: 'government_id' }, orderBy: { uploadedAt: 'desc' } });
      if (identityDoc) {
        try {
          const identityBuffer = await readPrivateDocument(identityDoc.storageKey);
          const face = await verifyFaceWithProvider({ selfieBase64: base64, selfieMimeType: mimeType, identityDocumentBase64: identityBuffer.toString('base64'), identityDocumentMimeType: identityDoc.mimeType });
          official = { configured: face.configured, verified: face.verified, detailsMatch: face.verified, details: { faceMatchPassed: face.faceMatchPassed, livenessPassed: face.livenessPassed }, provider: face.provider, reference: face.reference, message: face.message };
          comparison = { checks: { faceMatchPassed: face.faceMatchPassed, livenessPassed: face.livenessPassed, notes: face.configured && face.verified ? [] : [face.message] }, status: face.configured && face.verified ? 'checks_passed' : 'needs_review' };
          ocrConfigured = face.configured;
          ocrProvider = face.provider;
        } catch (error) {
          console.error('Face verification provider error:', error);
          comparison = { checks: { faceMatchPassed: false, livenessPassed: false, notes: ['Face verification provider is unavailable; manual review is required.'] }, status: 'needs_review' };
        }
      } else {
        comparison = { checks: { faceMatchPassed: null, livenessPassed: null, notes: ['Upload your government ID before submitting a selfie for face matching.'] }, status: 'needs_review' };
      }
    } else {
      try {
        const extraction = await extractDocumentFields({ documentType, mimeType, base64 });
        extractedFields = extraction.fields;
        ocrProvider = extraction.provider;
        ocrConfigured = extraction.configured;
      } catch (error) {
        console.error('Document OCR provider error:', error);
      }
      comparison = compareDocumentFields(driver, documentType, extractedFields);
      try {
        official = await verifyAgainstOfficialProvider(documentType, extractedFields, driver);
      } catch (error) {
        console.error('Official document verification provider error:', error);
        official.message = 'Official verification service could not be reached; manual review is required.';
      }
    }
    const checks: Record<string, any> = { ...comparison.checks, ocrConfigured, officialVerificationConfigured: official.configured, officialVerificationPassed: official.verified, officialDetailsMatch: official.detailsMatch, officialReturnedDetails: official.details, officialMessage: official.message };
    const expiryValue = extractedFields ? String(extractedFields.expiryDate || extractedFields.expiry_date || extractedFields.expirationDate || '') : '';
    const expiryDate = expiryValue && !Number.isNaN(new Date(expiryValue).getTime()) ? new Date(expiryValue) : null;
    let status: string = comparison.status;
    if (comparison.status === 'checks_passed' && official.verified) status = 'verified';
    else if ((official.configured && !official.verified) || !ocrConfigured || (!extractedFields && documentType !== 'selfie')) status = 'needs_review';
    if (checks.expiryValid === false) status = 'expired';

    const doc = await prisma.driverVerificationDocument.create({
      data: {
        driverId: driver.id, documentType, originalName: String(req.body?.fileName || documentType).replace(/[\\/]/g, '_').slice(0, 180),
        storageKey, mimeType, sizeBytes: buffer.length, status, extractedData: extractedFields as any,
        automatedChecks: checks as any, providerName: [ocrProvider, official.provider].filter(Boolean).join(' + '),
        providerReference: official.reference, expiryDate, reviewReason: [...(comparison.checks.notes as string[]), ...(official.verified ? [] : [official.message])].filter(Boolean).join(' '),
        verifiedAt: status === 'verified' ? new Date() : null,
      },
    });

    const statusField = documentType === 'government_id' ? 'identityStatus' : documentType === 'drivers_license' ? 'licenseStatus' : documentType === 'selfie' ? 'faceStatus' : 'vehicleStatus';
    await prisma.driver.update({ where: { id: driver.id }, data: { [statusField]: status, verified: false, online: false, status: 'pending', verificationStatus: 'pending_review' } as any });
    const { storageKey: hiddenStorageKey, ...safeDoc } = doc;
    res.status(201).json({ document: safeDoc, checks, message: status === 'verified' ? 'The document passed the configured checks.' : 'Document received. Some checks require further review.' });
  } catch (error: any) {
    if (storageKeyForCleanup) await deletePrivateDocument(storageKeyForCleanup).catch(() => {});
    console.error('Driver document upload error:', error);
    res.status(500).json({ error: error?.message || 'Could not process the document upload.' });
  }
});

// A driver can retrieve only their own uploaded document.
router.get('/me/verification/documents/:documentId/file', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId: req.user!.userId } });
    const doc = await prisma.driverVerificationDocument.findFirst({ where: { id: String(req.params.documentId), driverId: driver?.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const file = await readPrivateDocument(doc.storageKey);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName.replace(/["\r\n]/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file);
  } catch (error) {
    console.error('Driver document retrieval error:', error);
    res.status(500).json({ error: 'Could not retrieve document' });
  }
});

// Update current driver profile
router.put('/me', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const { name, phone, tricycle, documents, online } = req.body;

    const updateData: any = {
      userId: req.user!.userId,
      verified: driver.verified,
      status: driver.status,
    };

    if (typeof name === 'string') {
      updateData.name = name.trim().slice(0, 120);
    }

    if (typeof phone === 'string') {
      updateData.phone = phone.trim().slice(0, 40);
    }

    if (typeof tricycle === 'string') {
      updateData.tricycle = tricycle.trim().slice(0, 40);
    }

    if (Array.isArray(documents)) {
      updateData.documents = documents
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 10)
        .map(item => item.slice(0, 120));
    }

    if (typeof online === 'boolean') {
      if (online && (!driver.verified || driver.verificationStatus !== 'verified')) {
        return res.status(403).json({ error: 'Complete and pass driver verification before going online.' });
      }
      updateData.online = online;
      if (!online) {
        updateData.lastLocation = null;
      }
    }

    const updatedDriver = await prisma.driver.update({
      where: { id: driver.id },
      data: updateData,
    });

    // Notify subscribers if going offline
    if (online === false) {
      await notifySubscribers('drivers', driver.id, {
        id: driver.id,
        online: false,
        lastLocation: null,
      });
    }

    res.json({ driver: updatedDriver });
  } catch (error) {
    console.error('Update driver profile error:', error);
    res.status(500).json({ error: 'Failed to update driver profile' });
  }
});

// Save the driver's payout account and create (or reuse) a Paystack
// subaccount so fares are split directly to the driver's bank at settlement.
router.put('/me/payout-account', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    const accountNumber = String(req.body?.accountNumber || '').replace(/\s+/g, '');
    const bankCode = String(req.body?.bankCode || '').trim();
    const bankName = String(req.body?.bankName || '').trim();
    const accountName = String(req.body?.accountName || '').trim();

    if (!/^\d{10}$/.test(accountNumber) || !bankCode || !accountName) {
      return res.status(400).json({ error: 'A 10-digit account number, bank, and confirmed account name are required' });
    }

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) {
      return res.status(503).json({ error: 'Payouts are not configured yet. Please try again later.' });
    }

    // Re-resolve on the server at save time. Never trust an account name supplied
    // by the browser: the bank and account number must match Paystack's response.
    const resolveResponse = await fetch(
      'https://api.paystack.co/bank/resolve?account_number=' + encodeURIComponent(accountNumber) + '&bank_code=' + encodeURIComponent(bankCode),
      { headers: { Authorization: 'Bearer ' + secret } }
    );
    const resolveData = await resolveResponse.json() as any;
    if (!resolveResponse.ok || !resolveData?.status || !resolveData?.data?.account_name) {
      return res.status(400).json({ error: resolveData?.message || 'Paystack could not verify this bank account. Check the bank and account number.' });
    }
    const verifiedAccountName = String(resolveData.data.account_name).trim();
    const normalizeName = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (normalizeName(accountName) !== normalizeName(verifiedAccountName)) {
      return res.status(409).json({ error: 'The account name changed or no longer matches. Verify the account again before saving.' });
    }

    let subaccountCode = driver.payoutSubaccountCode;

    // Keep the existing Paystack split-settlement design. Update an existing
    // subaccount when details change to avoid orphaning old subaccounts; persist
    // the new bank details only after Paystack confirms the create/update.
    const detailsChanged =
      driver.payoutAccountNumber !== accountNumber || driver.payoutBankCode !== bankCode;

    if (!subaccountCode || detailsChanged) {
      const businessName = (driver.name || 'Tridash driver').slice(0, 100);
      const isUpdatingSubaccount = Boolean(subaccountCode && detailsChanged);
      const endpoint = isUpdatingSubaccount
        ? 'https://api.paystack.co/subaccount/' + encodeURIComponent(subaccountCode)
        : 'https://api.paystack.co/subaccount';
      const response = await fetch(endpoint, {
        method: isUpdatingSubaccount ? 'PUT' : 'POST',
        headers: {
          Authorization: 'Bearer ' + secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          business_name: businessName,
          bank_code: bankCode,
          account_number: accountNumber,
          percentage_charge: getCommissionPercent(),
        }),
      });
      const data = await response.json() as any;
      if (!response.ok || !data?.status) {
        throw new Error(data?.message || (isUpdatingSubaccount ? 'Paystack subaccount update failed' : 'Paystack subaccount creation failed'));
      }
      subaccountCode = String(data.data?.subaccount_code || subaccountCode || '');
      if (!subaccountCode) {
        throw new Error('Paystack did not return a subaccount code');
      }
    }

    const updatedDriver = await prisma.driver.update({
      where: { id: driver.id },
      data: {
        payoutAccountNumber: accountNumber,
        payoutBankCode: bankCode,
        payoutBankName: bankName,
        payoutAccountName: verifiedAccountName,
        payoutSubaccountCode: subaccountCode,
      },
    });

    res.json({ driver: updatedDriver });
  } catch (error: any) {
    console.error('Driver payout account error:', error);
    res.status(502).json({ error: error?.message || 'Could not save the payout account' });
  }
});

// Update driver location (during active ride)
router.post('/location', requireAuth(), requireDriver(), async (req: AuthenticatedRequest, res) => {
  try {
    const { lat, lng, rideId } = req.body;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Valid location required' });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Location coordinates are out of range' });
    }

    const driver = await prisma.driver.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    // Verify driver has an active ride
    const activeRide = await prisma.ride.findFirst({
      where: {
        driverId: req.user!.userId,
        id: rideId,
        status: { in: ['Accepted', 'In Progress'] },
      },
    });

    if (!activeRide) {
      return res.status(409).json({ error: 'Location updates are only allowed for your active ride' });
    }

    const lastLocation = {
      lat,
      lng,
      updatedAt: new Date().toISOString(),
    };

    const updatedDriver = await prisma.driver.update({
      where: { id: driver.id },
      data: { lastLocation },
    });

    // Notify subscribers of location update
    await notifySubscribers('drivers', driver.id, {
      id: driver.id,
      lastLocation,
    });

    res.json({ location: lastLocation });
  } catch (error) {
    console.error('Update driver location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Update any driver (admin or self)
router.put('/:id', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!user || !['driver', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    if (user.role === 'driver' && driver.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, phone, tricycle, documents, online, verified, status } = req.body;
    if (online === true && (!driver.verified || (driver as any).verificationStatus !== 'verified')) {
      return res.status(403).json({ error: 'Complete and pass driver verification before going online.' });
    }

    // Drivers cannot change verification or status
    if (user.role === 'driver' && (verified !== undefined || status !== undefined)) {
      return res.status(403).json({ error: 'Drivers cannot change verification or account status' });
    }

    const updateData: any = {};

    if (user.role === 'admin') {
      if (typeof name === 'string') updateData.name = name.trim().slice(0, 120);
      if (typeof phone === 'string') updateData.phone = phone.trim().slice(0, 40);
      if (typeof tricycle === 'string') updateData.tricycle = tricycle.trim().slice(0, 40);
      if (Array.isArray(documents)) {
        updateData.documents = documents
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 10)
          .map(item => item.slice(0, 120));
      }
      if (typeof online === 'boolean') updateData.online = online;
      if (typeof verified === 'boolean' && verified) {
        const requiredDocs = await prisma.driverVerificationDocument.findMany({ where: { driverId: driver.id, documentType: { in: requiredDocumentTypes((driver as any).operatingState || 'Ebonyi') } }, orderBy: { uploadedAt: 'desc' } });
        const latestByType = new Map<string, any>();
        for (const doc of requiredDocs) if (!latestByType.has(doc.documentType)) latestByType.set(doc.documentType, doc);
        const verifiedTypes = new Set([...latestByType.entries()].filter(([, doc]) => doc.status === 'verified').map(([type]) => type));
        if (requiredDocumentTypes((driver as any).operatingState || 'Ebonyi').some(type => !verifiedTypes.has(type))) {
          return res.status(409).json({ error: 'Identity, driving licence, and vehicle registration documents must each be verified before approving this driver.' });
        }
        if (!driver.firstName || !driver.lastName || !driver.dateOfBirth || !driver.tricycle) {
          return res.status(409).json({ error: 'The driver legal name, date of birth, and vehicle registration details must be completed first.' });
        }
        if (process.env.FACE_VERIFICATION_API_URL && driver.faceStatus !== 'verified') {
          return res.status(409).json({ error: 'Facial verification is enabled but has not passed yet.' });
        }
        updateData.verificationStatus = 'verified';
      }
      if (typeof verified === 'boolean') updateData.verified = verified;
      if (['active', 'suspended', 'pending'].includes(status)) updateData.status = status;
    } else {
      // Driver can only toggle online status, and only after verification.
      if (typeof online === 'boolean') {
        if (online && (!driver.verified || driver.verificationStatus !== 'verified')) {
          return res.status(403).json({ error: 'Complete and pass driver verification before going online.' });
        }
        updateData.online = online;
      }
    }

    const updatedDriver = await prisma.driver.update({
      where: { id: String(req.params.id) },
      data: updateData,
    });

    // Notify subscribers
    await notifySubscribers('drivers', updatedDriver.id, updatedDriver);

    res.json({ driver: updatedDriver });
  } catch (error) {
    console.error('Update driver error:', error);
    res.status(500).json({ error: 'Failed to update driver' });
  }
});

export default router;
