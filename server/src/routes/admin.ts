import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { readPrivateDocument } from '../services/privateDocumentStorage';
import { requiredDocumentTypes } from '../services/driverVerification';

const router = Router();

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'davedozie1@gmail.com';

// Get all users (admin only)
router.get('/users', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const users = await prisma.user.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        isSuperAdmin: true,
        status: true,
        createdAt: true,
      },
    });

    res.json({ users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Update user (admin only)
router.put('/users/:id', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Superadmin protection
    if (targetUser.isSuperAdmin && !currentUser.isSuperAdmin) {
      return res.status(403).json({ error: 'Superadmin account is protected' });
    }

    const { role, status } = req.body;
    const requestedRole = String(role || targetUser.role);

    if (!['passenger', 'driver', 'admin'].includes(requestedRole)) {
      return res.status(400).json({ error: 'Invalid account role' });
    }

    // Superadmin role cannot be changed
    if (targetUser.isSuperAdmin && requestedRole !== 'admin') {
      return res.status(403).json({ error: 'Superadmin role cannot be changed' });
    }

    // Only superadmin can grant admin access
    if (!currentUser.isSuperAdmin && requestedRole === 'admin' && targetUser.role !== 'admin') {
      return res.status(403).json({ error: 'Only the superadmin can grant administrator access' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: String(req.params.id) },
      data: {
        role: requestedRole,
        status: status === 'suspended' ? 'suspended' : status === 'active' ? 'active' : targetUser.status || 'active',
      },
    });

    // If changing to driver, create driver profile
    if (requestedRole === 'driver') {
      const existingDriver = await prisma.driver.findUnique({
        where: { userId: targetUser.id },
      });

      if (!existingDriver) {
        await prisma.driver.create({
          data: {
            userId: targetUser.id,
            name: targetUser.name,
            phone: '',
            rating: 0,
            verified: false,
            online: false,
            tricycle: '',
            documents: [],
            status: 'pending',
          },
        });
      }
    }

    res.json({
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status,
        isSuperAdmin: updatedUser.isSuperAdmin,
      },
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Driver verification queue with document metadata. Storage keys are never returned to the browser.
router.get('/driver-verifications', requireAuth(), requireAdmin(), async (_req: AuthenticatedRequest, res) => {
  try {
    const applications = await prisma.driver.findMany({
      where: { OR: [{ verified: false }, { verificationStatus: { not: 'verified' } }] },
      select: {
        id: true, userId: true, name: true, firstName: true, lastName: true, otherNames: true, dateOfBirth: true,
        operatingState: true, operatingArea: true, verificationStatus: true, identityStatus: true, licenseStatus: true, vehicleStatus: true,
        faceStatus: true, phone: true, homeAddress: true, tricycle: true, vehicleMake: true, vehicleModel: true, vehicleColor: true, verified: true, online: true, status: true, createdAt: true, updatedAt: true,
        user: { select: { email: true } },
        verificationDocuments: { orderBy: { uploadedAt: 'desc' }, select: {
          id: true, driverId: true, documentType: true, originalName: true, mimeType: true, sizeBytes: true, status: true,
          extractedData: true, automatedChecks: true, providerName: true, providerReference: true, expiryDate: true,
          reviewReason: true, reviewedById: true, reviewedAt: true, uploadedAt: true, verifiedAt: true, createdAt: true, updatedAt: true,
        } },
      },
      orderBy: { updatedAt: 'desc' }, take: 200,
    });
    res.json({ applications: applications.map(application => ({ ...application, requiredDocumentTypes: requiredDocumentTypes(application.operatingState) })) });
  } catch (error) {
    console.error('Admin driver verification queue error:', error);
    res.status(500).json({ error: 'Could not load driver verification applications' });
  }
});

// Serve a document only to an authenticated administrator.
router.get('/driver-verifications/:driverId/documents/:documentId/file', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const doc = await prisma.driverVerificationDocument.findFirst({ where: { id: String(req.params.documentId), driverId: String(req.params.driverId) } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const file = await readPrivateDocument(doc.storageKey);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName.replace(/["\r\n]/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file);
  } catch (error) {
    console.error('Admin document retrieval error:', error);
    res.status(500).json({ error: 'Could not retrieve document' });
  }
});

// Record an admin review for one document. Manual verification requires a reason/audit note.
router.put('/driver-verifications/:driverId/documents/:documentId', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const status = String(req.body?.status || '');
    const reviewReason = String(req.body?.reviewReason || '').trim().slice(0, 1000);
    if (!['verified', 'rejected', 'needs_review'].includes(status)) return res.status(400).json({ error: 'Choose a valid review status.' });
    if ((status === 'verified' || status === 'rejected') && reviewReason.length < 8) return res.status(400).json({ error: 'Add a review note explaining the decision.' });
    const doc = await prisma.driverVerificationDocument.findFirst({ where: { id: String(req.params.documentId), driverId: String(req.params.driverId) } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const updated = await prisma.driverVerificationDocument.update({
      where: { id: doc.id },
      data: { status, reviewReason, reviewedById: req.user!.userId, reviewedAt: new Date(), verifiedAt: status === 'verified' ? new Date() : null },
    });
    const statusField = doc.documentType === 'government_id' ? 'identityStatus' : doc.documentType === 'drivers_license' ? 'licenseStatus' : doc.documentType === 'selfie' ? 'faceStatus' : 'vehicleStatus';
    await prisma.driver.update({ where: { id: doc.driverId }, data: { [statusField]: status, verified: false, online: false, status: 'pending', verificationStatus: 'pending_review' } as any });
    const { storageKey, ...safeDoc } = updated;
    res.json({ document: safeDoc, message: 'Document review saved.' });
  } catch (error) {
    console.error('Admin document review error:', error);
    res.status(500).json({ error: 'Could not save document review' });
  }
});

// Final driver approval is blocked until every required document has passed review.
router.post('/driver-verifications/:driverId/approve', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const driver = await prisma.driver.findUnique({ where: { id: String(req.params.driverId) }, include: { verificationDocuments: true } });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    if (!driver.firstName || !driver.lastName || !driver.dateOfBirth || !driver.homeAddress || !driver.tricycle || !driver.vehicleMake || !driver.vehicleModel || !driver.vehicleColor || !driver.operatingArea) return res.status(409).json({ error: "The driver's legal name, date of birth, home address, vehicle details and operating area must be completed first." });
    const latestByType = new Map<string, any>();
    for (const doc of [...driver.verificationDocuments].sort((a: any, b: any) => b.uploadedAt.getTime() - a.uploadedAt.getTime())) {
      if (!latestByType.has(doc.documentType)) latestByType.set(doc.documentType, doc);
    }
    const verifiedTypes = new Set([...latestByType.entries()].filter(([, doc]) => doc.status === 'verified').map(([type]) => type));
    const missing = requiredDocumentTypes(driver.operatingState).filter(type => !verifiedTypes.has(type));
    if (missing.length) return res.status(409).json({ error: 'These required checks are not verified yet: ' + missing.join(', ') });
    if (process.env.FACE_VERIFICATION_API_URL && driver.faceStatus !== 'verified') return res.status(409).json({ error: 'Facial verification is enabled but has not passed yet.' });
    const updated = await prisma.driver.update({ where: { id: driver.id }, data: { verified: true, online: false, status: 'active', verificationStatus: 'verified' } });
    res.json({ driver: updated, message: 'Driver approved after all required document checks passed.' });
  } catch (error) {
    console.error('Admin driver approval error:', error);
    res.status(500).json({ error: 'Could not approve driver' });
  }
});

// Reset all users (superadmin only)
router.post('/reset-users', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    if (!currentUser?.isSuperAdmin || currentUser.email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Superadmin access required' });
    }

    // Delete all non-superadmin users
    const usersToDelete = await prisma.user.findMany({
      where: {
        AND: [
          { isSuperAdmin: false },
          { email: { not: SUPER_ADMIN_EMAIL } },
        ],
      },
    });

    const userIds = usersToDelete.map(u => u.id);

    // Delete related records
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.profile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.driver.deleteMany({ where: { userId: { in: userIds } } });

    // Delete users
    const deleteResult = await prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });

    res.json({
      ok: true,
      deletedAppUsers: deleteResult.count,
    });
  } catch (error) {
    console.error('Reset users error:', error);
    res.status(500).json({ error: 'Failed to reset users' });
  }
});

// Get all incidents (admin only)
router.get('/incidents', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const incidents = await prisma.incident.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ incidents });
  } catch (error) {
    console.error('Get incidents error:', error);
    res.status(500).json({ error: 'Failed to get incidents' });
  }
});

// Get all payments (admin only)
router.get('/payments', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
  try {
    const payments = await prisma.payment.findMany({
      take: 200,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ payments });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Failed to get payments' });
  }
});

export default router;
