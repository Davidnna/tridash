import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { notifyUsers } from '../services/notifications';
import { sendSms } from '../services/sms';

const router = Router();

function publicAppUrl(path: string) {
    const configured = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
    const origin = configured.split(',')[0].trim().replace(/\/$/, '');
    return `${origin}${path}`;
}

router.post('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
        if (!user || user.status !== 'active') {
            return res.status(403).json({ error: 'An active account is required' });
        }

        const incidentType = String(req.body?.type || 'complaint');
        const details = String(req.body?.message || '').trim();
        const category = String(req.body?.category || 'other').trim().toLowerCase();
        const allowedCategories = ['safety', 'conduct', 'vehicle', 'route', 'payment', 'service', 'other'];
        if (details.length < 5) {
            return res.status(400).json({ error: 'Describe the issue in at least five characters' });
        }
        if (!['SOS', 'complaint', 'driver-report', 'admin-report'].includes(incidentType)) {
            return res.status(400).json({ error: 'Unsupported incident type' });
        }
        if (!allowedCategories.includes(category)) {
            return res.status(400).json({ error: 'Choose a valid report category' });
        }
        if (incidentType === 'SOS' && !['passenger', 'driver'].includes(user.role)) {
            return res.status(403).json({ error: 'SOS is available to passengers and drivers' });
        }
        if (incidentType === 'complaint' && user.role !== 'passenger') {
            return res.status(403).json({ error: 'Passenger reports must use the complaint type' });
        }
        if (incidentType === 'driver-report' && user.role !== 'driver') {
            return res.status(403).json({ error: 'Driver reports must be submitted by a driver account' });
        }
        if (user.role === 'admin' && incidentType !== 'admin-report') {
            return res.status(400).json({ error: 'Administrator reports must use type admin-report' });
        }
        if (user.role !== 'admin' && incidentType === 'admin-report') {
            return res.status(403).json({ error: 'Administrator access required' });
        }

        let ride = null;
        let expectedReportedUserId: string | null = null;
        const rideId = String(req.body?.rideId || '').trim();
        if (rideId) {
            ride = await prisma.ride.findUnique({ where: { id: rideId } });
            if (!ride) return res.status(404).json({ error: 'Related trip was not found' });
            if (ride.passengerId !== user.id && ride.driverId !== user.id && user.role !== 'admin') {
                return res.status(403).json({ error: 'You are not authorised to report this trip' });
            }
            expectedReportedUserId = user.role === 'passenger' ? ride.driverId : user.role === 'driver' ? ride.passengerId : null;
        } else if (user.role === 'passenger' || incidentType === 'SOS') {
            return res.status(400).json({ error: 'A related active or previous trip is required for this report' });
        }

        const requestedReportedUserId = String(req.body?.reportedUserId || '').trim() || null;
        if (requestedReportedUserId && requestedReportedUserId !== expectedReportedUserId) {
            return res.status(400).json({ error: 'The reported account must be a participant in the selected trip' });
        }
        if (incidentType === 'SOS' && (!ride || ['Completed', 'Cancelled'].includes(ride.status))) {
            return res.status(409).json({ error: 'SOS is only available during an active trip' });
        }

        const incidentAndShare = await prisma.$transaction(async tx => {
            const incident = await tx.incident.create({
                data: {
                    rideId: ride?.id,
                    userId: user.id,
                    reportedUserId: expectedReportedUserId,
                    driverId: ride?.driverId || (user.role === 'driver' ? user.id : null),
                    type: incidentType,
                    category,
                    severity: incidentType === 'SOS' ? 'high' : ['normal', 'high'].includes(String(req.body?.severity)) ? String(req.body.severity) : 'normal',
                    message: details.slice(0, 2000),
                },
            });
            await tx.incidentActivity.create({
                data: {
                    incidentId: incident.id,
                    actorId: user.id,
                    action: incidentType === 'SOS' ? 'sos_activated' : 'report_submitted',
                    newStatus: 'open',
                    note: details.slice(0, 1000),
                },
            });

            let shareUrl: string | null = null;
            if (incidentType === 'SOS' && ride) {
                const token = crypto.randomUUID();
                await tx.tripShare.create({
                    data: {
                        rideId: ride.id,
                        token,
                        createdBy: user.id,
                        expiresAt: BigInt(Date.now() + 24 * 60 * 60 * 1000),
                    },
                });
                shareUrl = publicAppUrl(`/shared-trip/${token}`);
            }
            return { incident, shareUrl };
        });

        const admins = await prisma.user.findMany({ where: { role: 'admin', status: 'active' }, select: { id: true } });
        await notifyUsers(
            admins.map(admin => admin.id),
            incidentType === 'SOS' ? 'Emergency alert recorded' : 'New safety report',
            `${incidentType} · ${category}: ${details.slice(0, 160)}`,
            '/admin/reports',
        );

        if (incidentType === 'SOS' && ride) {
            const reporterProfile = await prisma.profile.findUnique({ where: { userId: user.id } });
            const emergencyPhone = reporterProfile?.emergencyPhone?.trim() || '';
            const emergencyName = reporterProfile?.emergencyName?.trim() || 'Emergency contact';
            const sms = emergencyPhone && incidentAndShare.shareUrl
                ? await sendSms(emergencyPhone, `TRIDASH EMERGENCY: ${user.name} activated SOS during a trip. Route: ${ride.pickup} to ${ride.destination}. View trip: ${incidentAndShare.shareUrl}`)
                : { sent: false, status: 'not_configured' as const, message: 'No emergency contact number is saved.' };
            return res.status(201).json({
                incident: incidentAndShare.incident,
                operationsAlertCreated: admins.length > 0,
                emergencyContact: emergencyPhone ? { name: emergencyName, phone: emergencyPhone } : null,
                emergencyContactSms: sms,
                tripShareUrl: incidentAndShare.shareUrl,
                emergencyServicesConnected: false,
            });
        }

        return res.status(201).json({ incident: incidentAndShare.incident, operationsAlertCreated: admins.length > 0 });
    } catch (error) {
        console.error('Create incident error:', error);
        return res.status(500).json({ error: 'Failed to record incident' });
    }
});

export default router;
