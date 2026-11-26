import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { getFirebaseAuth } from '../utils/firebase';
import { readPrivateDocument } from '../services/privateDocumentStorage';
import { requiredDocumentTypes } from '../services/driverVerification';
import { notifyUser } from '../services/notifications';

const router = Router();

const SUPER_ADMIN_EMAIL = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();

// Aggregate dashboard metrics from the database so totals are not limited by list-page caps.
router.get('/overview', requireAuth(), requireAdmin(), async (_req: AuthenticatedRequest, res) => {
    try {
        const [passengers, drivers, verifiedDrivers, pendingDrivers, tricycles, activeRides, completedRides, openIncidents, payments] = await Promise.all([
            prisma.user.count({ where: { role: 'passenger' } }),
            prisma.driver.count(),
            prisma.driver.count({ where: { verified: true, status: 'active' } }),
            prisma.driver.count({ where: { verified: false, verificationStatus: { notIn: ['verified', 'rejected'] } } }),
            prisma.tricycle.count(),
            prisma.ride.count({ where: { status: { in: ['Requested', 'Accepted', 'In Progress'] } } }),
            prisma.ride.count({ where: { status: 'Completed' } }),
            prisma.incident.count({ where: { status: { notIn: ['resolved', 'closed'] } } }),
            prisma.payment.aggregate({ where: { status: { in: ['Paid', 'Success', 'Successful'] } }, _sum: { amount: true }, _count: true }),
        ]);
        res.json({ overview: { passengers, drivers, verifiedDrivers, pendingDrivers, tricycles, activeRides, completedRides, openIncidents, paidPayments: payments._count, paidPaymentValue: payments._sum.amount || 0 } });
    } catch (error) {
        console.error('Admin overview error:', error);
        res.status(500).json({ error: 'Could not load aggregate dashboard metrics' });
    }
});

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

        const nextStatus = status === 'suspended' ? 'suspended' : status === 'inactive' ? 'inactive' : status === 'active' ? 'active' : targetUser.status || 'active';
        if (targetUser.id === currentUser.id && nextStatus !== 'active') {
            return res.status(409).json({ error: 'You cannot suspend or deactivate your own administrator session' });
        }
        const updatedUser = await prisma.$transaction(async tx => {
            const updated = await tx.user.update({
                where: { id: String(req.params.id) },
                data: { role: requestedRole, status: nextStatus },
            });
            if (['inactive', 'suspended'].includes(nextStatus)) {
                await tx.session.deleteMany({ where: { userId: targetUser.id } });
                await tx.pushToken.deleteMany({ where: { userId: targetUser.id } });
            }
            return updated;
        });

        if (['inactive', 'suspended'].includes(updatedUser.status) && targetUser.role === 'driver') {
            await prisma.driver.updateMany({ where: { userId: targetUser.id }, data: { online: false, status: updatedUser.status } });
        }
        if (targetUser.role === 'driver' && requestedRole !== 'driver') {
            await prisma.driver.updateMany({ where: { userId: targetUser.id }, data: { online: false } });
        }
        if (updatedUser.status === 'active' && targetUser.role === 'driver') {
            await prisma.driver.updateMany({ where: { userId: targetUser.id, verified: true }, data: { status: 'active' } });
            await prisma.driver.updateMany({ where: { userId: targetUser.id, verified: false }, data: { status: 'pending' } });
        }

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
                verificationDocuments: {
                    orderBy: { uploadedAt: 'desc' }, select: {
                        id: true, driverId: true, documentType: true, originalName: true, mimeType: true, sizeBytes: true, status: true,
                        extractedData: true, automatedChecks: true, providerName: true, providerReference: true, expiryDate: true,
                        reviewReason: true, reviewedById: true, reviewedAt: true, uploadedAt: true, verifiedAt: true, createdAt: true, updatedAt: true,
                    }
                },
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
        const plateNumber = driver.tricycle.toUpperCase();
        const plateOwner = await prisma.tricycle.findUnique({ where: { plateNumber } });
        if (plateOwner && plateOwner.driverId !== driver.userId) {
            return res.status(409).json({ error: 'This tricycle registration number is already assigned to another driver.' });
        }
        const updated = await prisma.$transaction(async tx => {
            const approvedDriver = await tx.driver.update({ where: { id: driver.id }, data: { verified: true, online: false, status: 'active', verificationStatus: 'verified', vehicleStatus: 'verified' } });
            await tx.tricycle.upsert({
                where: { plateNumber },
                create: { driverId: driver.userId, plateNumber, make: driver.vehicleMake, model: driver.vehicleModel, color: driver.vehicleColor, verificationStatus: 'verified', status: 'active' },
                update: { driverId: driver.userId, make: driver.vehicleMake, model: driver.vehicleModel, color: driver.vehicleColor, verificationStatus: 'verified', status: 'active' },
            });
            return approvedDriver;
        });
        res.json({ driver: updated, message: 'Driver approved after all required document checks passed.' });
    } catch (error: any) {
        if (error?.code === 'P2002') return res.status(409).json({ error: 'This tricycle registration number is already assigned to another driver.' });
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

        if (!SUPER_ADMIN_EMAIL || !currentUser?.isSuperAdmin || currentUser.email.toLowerCase() !== SUPER_ADMIN_EMAIL) {
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

        // Delete Firebase users
        const firebaseAuth = getFirebaseAuth();
        let deletedFirebaseUsers = 0;

        if (firebaseAuth) {
            try {
                const listResult = await firebaseAuth.listUsers(1000);
                const firebaseUidsToDelete = listResult.users
                    .filter((user: { email?: string }) => user.email?.toLowerCase() !== SUPER_ADMIN_EMAIL)
                    .map((user: { uid: string }) => user.uid);

                if (firebaseUidsToDelete.length > 0) {
                    const result = await firebaseAuth.deleteUsers(firebaseUidsToDelete);
                    deletedFirebaseUsers = result.successCount;
                }
            } catch (error) {
                console.error('Firebase user deletion error:', error);
            }
        }

        res.json({
            ok: true,
            deletedAppUsers: deleteResult.count,
            deletedFirebaseUsers,
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
            include: {
                user: { select: { id: true, name: true, role: true, phone: true } },
                reportedUser: { select: { id: true, name: true, role: true, phone: true } },
                assignedTo: { select: { id: true, name: true } },
                ride: { select: { id: true, pickup: true, destination: true, status: true, requestedAt: true } },
                activities: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { id: true, name: true, role: true } } } },
            },
        });

        res.json({ incidents });
    } catch (error) {
        console.error('Get incidents error:', error);
        res.status(500).json({ error: 'Failed to get incidents' });
    }
});



// Review and resolve an incident with an auditable status and resolution record.
router.patch('/incidents/:id', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
    try {
        const status = String(req.body.status || '');
        const resolution = String(req.body.resolution || '').trim();
        if (!['open', 'under_review', 'resolved', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Invalid incident status' });
        }
        if (['resolved', 'closed'].includes(status) && resolution.length < 5) {
            return res.status(400).json({ error: 'A resolution note of at least five characters is required' });
        }
        const incident = await prisma.$transaction(async tx => {
            const existing = await tx.incident.findUnique({ where: { id: String(req.params.id) } });
            if (!existing) throw Object.assign(new Error('Incident not found'), { statusCode: 404 });
            const updated = await tx.incident.update({
                where: { id: existing.id },
                data: {
                    status,
                    assignedToId: req.user!.userId,
                    ...(resolution ? { resolution: resolution.slice(0, 3000) } : {}),
                    resolvedAt: ['resolved', 'closed'].includes(status) ? new Date() : null,
                },
            });
            await tx.incidentActivity.create({
                data: {
                    incidentId: existing.id,
                    actorId: req.user!.userId,
                    action: 'status_updated',
                    previousStatus: existing.status,
                    newStatus: status,
                    note: resolution || null,
                },
            });
            return updated;
        });
        const reporterRoute = incident.userId ? await prisma.user.findUnique({ where: { id: incident.userId }, select: { role: true } }) : null;
        if (incident.userId) {
            const destination = reporterRoute?.role === 'driver' ? '/driver' : '/safety';
            await notifyUser(incident.userId, 'Your safety report was updated', `The report status is now ${incident.status.replace(/_/g, ' ')}.`, destination);
        }
        res.json({ incident });
    } catch (error: any) {
        const status = Number(error?.statusCode) || 500;
        if (status === 500) console.error('Update incident error:', error);
        res.status(status).json({ error: error?.message || 'Failed to update incident' });
    }
});

// Independent tricycle register and lifecycle management.
router.get('/tricycles', requireAuth(), requireAdmin(), async (_req: AuthenticatedRequest, res) => {
    try {
        const tricycles = await prisma.tricycle.findMany({
            include: { driver: { select: { id: true, userId: true, name: true, phone: true, verified: true, status: true } } },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ tricycles });
    } catch (error) {
        console.error('Get tricycles error:', error);
        res.status(500).json({ error: 'Failed to load tricycles' });
    }
});

router.post('/tricycles', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
    try {
        const { driverId, plateNumber, make, model, color, registrationDetails } = req.body;
        const plate = String(plateNumber || '').trim().toUpperCase();
        if (!driverId || plate.length < 3 || !String(make || '').trim() || !String(model || '').trim() || !String(color || '').trim()) {
            return res.status(400).json({ error: 'Driver, plate number, make, model and colour are required' });
        }
        const driver = await prisma.driver.findUnique({ where: { userId: String(driverId) } });
        if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
        const activeVehicle = await prisma.tricycle.findFirst({ where: { driverId: driver.userId, status: 'active' } });
        if (activeVehicle) return res.status(409).json({ error: 'This driver already has an active registered tricycle. Deactivate the existing vehicle before registering another.' });
        const tricycle = await prisma.$transaction(async tx => {
            const created = await tx.tricycle.create({
                data: {
                    driverId: driver.userId,
                    plateNumber: plate,
                    make: String(make).trim().slice(0, 80),
                    model: String(model).trim().slice(0, 80),
                    color: String(color).trim().slice(0, 40),
                    registrationDetails: String(registrationDetails || '').trim().slice(0, 2000),
                },
            });
            await tx.driver.update({
                where: { id: driver.id },
                data: {
                    tricycle: plate,
                    vehicleMake: created.make,
                    vehicleModel: created.model,
                    vehicleColor: created.color,
                    vehicleStatus: 'pending',
                    verificationStatus: 'pending_review',
                    verified: false,
                    online: false,
                    status: 'pending',
                },
            });
            await tx.driverVerificationDocument.updateMany({
                where: { driverId: driver.id, documentType: 'vehicle_registration' },
                data: { status: 'needs_review', verifiedAt: null, reviewedAt: null, reviewedById: null, reviewReason: 'Vehicle record changed; recheck the registration document against the new vehicle details.' },
            });
            return created;
        });
        res.status(201).json({ tricycle });
    } catch (error: any) {
        if (error?.code === 'P2002') return res.status(409).json({ error: 'That plate number is already registered' });
        console.error('Create tricycle error:', error);
        res.status(500).json({ error: 'Failed to register tricycle' });
    }
});

router.patch('/tricycles/:id', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
    try {
        const existing = await prisma.tricycle.findUnique({ where: { id: String(req.params.id) } });
        if (!existing) return res.status(404).json({ error: 'Tricycle not found' });
        const allowedStatuses = ['active', 'suspended', 'inactive'];
        const allowedVerification = ['pending', 'verified', 'rejected'];
        const data: Record<string, any> = {};
        if (req.body.status !== undefined) {
            if (!allowedStatuses.includes(String(req.body.status))) return res.status(400).json({ error: 'Invalid vehicle status' });
            data.status = String(req.body.status);
        }
        if (req.body.verificationStatus !== undefined) {
            if (!allowedVerification.includes(String(req.body.verificationStatus))) return res.status(400).json({ error: 'Invalid vehicle verification status' });
            data.verificationStatus = String(req.body.verificationStatus);
        }
        for (const [field, maxLength] of [['plateNumber', 40], ['make', 80], ['model', 80], ['color', 40], ['registrationDetails', 2000]] as const) {
            if (req.body[field] !== undefined) {
                const value = String(req.body[field]).trim();
                if (!value && field !== 'registrationDetails') return res.status(400).json({ error: `${field} cannot be empty` });
                data[field] = value.slice(0, maxLength);
            }
        }
        if (data.plateNumber) data.plateNumber = data.plateNumber.toUpperCase();
        if (req.body.driverId !== undefined) {
            const driverId = String(req.body.driverId).trim();
            const driver = await prisma.driver.findUnique({ where: { userId: driverId } });
            if (!driver) return res.status(404).json({ error: 'Assigned driver profile not found' });
            const otherActiveVehicle = await prisma.tricycle.findFirst({ where: { driverId: driver.userId, status: 'active', id: { not: existing.id } } });
            if (driver.userId !== existing.driverId && otherActiveVehicle) return res.status(409).json({ error: 'This driver already has another active registered tricycle.' });
            data.driverId = driver.userId;
        }
        if (!Object.keys(data).length) return res.status(400).json({ error: 'No valid tricycle fields supplied' });
        const tricycle = await prisma.$transaction(async tx => {
            const updated = await tx.tricycle.update({ where: { id: existing.id }, data });
            const vehicleIdentityChanged = Boolean(data.plateNumber || data.make || data.model || data.color || data.registrationDetails || (data.driverId && data.driverId !== existing.driverId));
            if (data.driverId && data.driverId !== existing.driverId) {
                await tx.driver.updateMany({
                    where: { userId: existing.driverId },
                    data: { online: false, verified: false, status: 'pending', verificationStatus: 'pending_review', vehicleStatus: 'pending', tricycle: '', vehicleMake: '', vehicleModel: '', vehicleColor: '' },
                });
                await tx.driverVerificationDocument.updateMany({
                    where: { driver: { is: { userId: existing.driverId } }, documentType: 'vehicle_registration' },
                    data: { status: 'needs_review', verifiedAt: null, reviewedAt: null, reviewedById: null, reviewReason: "The assigned vehicle changed; review the driver's current vehicle documents." },
                });
            }
            await tx.driver.updateMany({
                where: { userId: updated.driverId },
                data: {
                    ...(vehicleIdentityChanged ? { tricycle: updated.plateNumber, vehicleMake: updated.make, vehicleModel: updated.model, vehicleColor: updated.color, verified: false, online: false, status: 'pending', verificationStatus: 'pending_review', vehicleStatus: 'pending' } : {}),
                    ...(data.verificationStatus && !vehicleIdentityChanged ? { vehicleStatus: data.verificationStatus, ...(data.verificationStatus !== 'verified' ? { verified: false, online: false, status: 'pending', verificationStatus: 'pending_review' } : {}) } : {}),
                    ...(data.status && data.status !== 'active' ? { online: false } : {}),
                },
            });
            if (vehicleIdentityChanged) {
                await tx.driverVerificationDocument.updateMany({
                    where: { driver: { is: { userId: updated.driverId } }, documentType: 'vehicle_registration' },
                    data: { status: 'needs_review', verifiedAt: null, reviewedAt: null, reviewedById: null, reviewReason: 'Vehicle details changed; recheck the registration document.' },
                });
            }
            return updated;
        });
        res.json({ tricycle });
    } catch (error: any) {
        if (error?.code === 'P2002') return res.status(409).json({ error: 'That plate number is already registered' });
        console.error('Update tricycle error:', error);
        res.status(500).json({ error: 'Failed to update tricycle' });
    }
});

// Platform settings are persisted as JSON values; only an administrator can change them.
router.get('/settings', requireAuth(), requireAdmin(), async (_req: AuthenticatedRequest, res) => {
    try {
        const settings = await prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
        res.json({ settings });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Failed to load platform settings' });
    }
});

router.put('/settings/:key', requireAuth(), requireAdmin(), async (req: AuthenticatedRequest, res) => {
    try {
        const key = String(req.params.key).trim();
        const allowed = ['platform_name', 'support_email', 'support_phone', 'platform_commission_percent', 'service_status', 'service_area', 'base_fare_ngn', 'fare_per_km_ngn', 'minimum_fare_ngn'];
        if (!allowed.includes(key)) return res.status(400).json({ error: 'This setting cannot be changed through the administrator console' });
        const value = req.body.value;
        if (value === undefined || value === null) return res.status(400).json({ error: 'A setting value is required' });
        if (key === 'service_status' && !['active', 'paused'].includes(String(value))) {
            return res.status(400).json({ error: 'Service status must be active or paused' });
        }
        if (key === 'support_email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
            return res.status(400).json({ error: 'Enter a valid support email address' });
        }
        if (key === 'platform_commission_percent' && (typeof value !== 'number' || value < 0 || value > 50)) {
            return res.status(400).json({ error: 'Commission must be between 0 and 50 percent' });
        }
        if (['base_fare_ngn', 'fare_per_km_ngn', 'minimum_fare_ngn'].includes(key) && (!Number.isInteger(value) || value < 0 || value > 100000)) {
            return res.status(400).json({ error: 'Fare settings must be whole naira amounts between 0 and 100,000' });
        }
        const setting = await prisma.platformSetting.upsert({
            where: { key },
            create: { key, value, updatedBy: req.user!.userId },
            update: { value, updatedBy: req.user!.userId },
        });
        if (key === 'service_status' && value === 'paused') {
            await prisma.driver.updateMany({ where: { online: true }, data: { online: false, lastLocation: null } });
        }
        res.json({ setting });
    } catch (error) {
        console.error('Update setting error:', error);
        res.status(500).json({ error: 'Failed to update platform setting' });
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
