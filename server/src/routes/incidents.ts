import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Create incident
router.post('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
        });

        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Admin reports
        if (user.role === 'admin') {
            const { type, severity, message } = req.body;

            if (type !== 'admin-report') {
                return res.status(400).json({ error: 'Admin reports must use type admin-report' });
            }

            const msg = String(message || '').trim();

            if (msg.length < 5) {
                return res.status(400).json({ error: 'Incident details are required' });
            }

            const incident = await prisma.incident.create({
                data: {
                    type: 'admin-report',
                    severity: String(severity || 'normal'),
                    message: msg.slice(0, 2000),
                    userId: req.user!.userId,
                },
            });

            return res.status(201).json({ incident });
        }

        // Passenger incidents
        const { rideId, type, severity, message } = req.body;

        const ride = await prisma.ride.findUnique({
            where: { id: rideId },
        });

        if (!ride || ride.passengerId !== req.user!.userId) {
            return res.status(403).json({ error: 'Incident ride is not authorized' });
        }

        const incidentType = String(type || 'complaint');
        const msg = String(message || '').trim();

        if (!['SOS', 'complaint'].includes(incidentType)) {
            return res.status(400).json({ error: 'Unsupported incident type' });
        }

        if (incidentType === 'SOS') {
            if (['Completed', 'Cancelled'].includes(ride.status)) {
                return res.status(409).json({ error: 'SOS is only available during an active ride' });
            }

            if (msg.length < 5) {
                return res.status(400).json({ error: 'SOS details are required' });
            }

            const incident = await prisma.incident.create({
                data: {
                    rideId: ride.id,
                    userId: req.user!.userId,
                    driverId: ride.driverId || null,
                    type: 'SOS',
                    severity: 'high',
                    message: msg.slice(0, 1000),
                },
            });

            return res.status(201).json({ incident });
        }

        // Complaint
        if (msg.length < 5) {
            return res.status(400).json({ error: 'Describe the issue in a little more detail' });
        }

        const incident = await prisma.incident.create({
            data: {
                rideId: ride.id,
                userId: req.user!.userId,
                driverId: ride.driverId || null,
                type: 'complaint',
                severity: String(severity || 'normal'),
                message: msg.slice(0, 2000),
            },
        });

        res.status(201).json({ incident });
    } catch (error) {
        console.error('Create incident error:', error);
        res.status(500).json({ error: 'Failed to record incident' });
    }
});

export default router;
