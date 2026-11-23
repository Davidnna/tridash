import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Create trip share
router.post('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const { rideId } = req.body;

        const ride = await prisma.ride.findUnique({
            where: { id: rideId },
        });

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        if (ride.passengerId !== req.user!.userId && ride.driverId !== req.user!.userId) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        if (['Completed', 'Cancelled'].includes(ride.status)) {
            return res.status(409).json({ error: 'Only active rides can be shared' });
        }

        const token = crypto.randomUUID();
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        const tripShare = await prisma.tripShare.create({
            data: {
                rideId,
                token,
                createdBy: req.user!.userId,
                expiresAt: BigInt(expiresAt),
            },
        });

        res.status(201).json({
            share: {
                ...tripShare,
                expiresAt: Number(tripShare.expiresAt),
            },
            url: '/shared-trip/' + token,
        });
    } catch (error) {
        console.error('Create trip share error:', error);
        res.status(500).json({ error: 'Unable to create share link' });
    }
});

// Get shared trip
router.get('/:token', async (req, res) => {
    try {
        const tripShare = await prisma.tripShare.findFirst({
            where: {
                token: req.params.token,
                expiresAt: {
                    gt: BigInt(Date.now()),
                },
            },
        });

        if (!tripShare) {
            return res.status(404).json({ error: 'Share link expired or invalid' });
        }

        const ride = await prisma.ride.findUnique({
            where: { id: tripShare.rideId },
        });

        if (!ride) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        let driver = null;

        if (ride.driverId) {
            driver = await prisma.driver.findUnique({
                where: { userId: ride.driverId },
            });
        }

        // Public tracking links must never expose full database records. Return
        // only the route and live-tracking fields required by SharedTripRoute.
        res.json({
            ride: {
                id: ride.id,
                status: ride.status,
                pickup: ride.pickup,
                destination: ride.destination,
                amount: ride.amount,
                pickupCoords: ride.pickupCoords,
                destinationCoords: ride.destinationCoords,
                driver: ride.driver,
                tricycle: ride.tricycle,
            },
            driver: driver ? {
                name: driver.name,
                tricycle: driver.tricycle,
                lastLocation: driver.lastLocation,
            } : null,
        });
    } catch (error) {
        console.error('Get shared trip error:', error);
        res.status(500).json({ error: 'Failed to get shared trip' });
    }
});

export default router;
