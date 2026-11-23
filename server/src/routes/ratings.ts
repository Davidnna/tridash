import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Create rating
router.post('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        if (req.user!.role !== 'passenger') {
            return res.status(403).json({ error: 'Only passenger accounts can rate completed rides' });
        }

        const { rideId, rating, review } = req.body;

        const ride = await prisma.ride.findUnique({
            where: { id: rideId },
        });

        if (!ride || ride.passengerId !== req.user!.userId || ride.status !== 'Completed') {
            return res.status(403).json({ error: 'Only completed rides belonging to you can be rated' });
        }

        const ratingValue = Number(rating);

        if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        // Check if already rated
        const existingRating = await prisma.rating.findFirst({
            where: {
                rideId,
                userId: req.user!.userId,
            },
        });

        if (existingRating) {
            return res.status(409).json({ error: 'This completed ride has already been rated' });
        }

        const newRating = await prisma.rating.create({
            data: {
                rideId,
                userId: req.user!.userId,
                driverId: ride.driverId || null,
                rating: ratingValue,
                review: String(review || '').slice(0, 1000),
            },
        });

        // Update driver's average rating
        if (ride.driverId) {
            const allDriverRatings = await prisma.rating.findMany({
                where: { driverId: ride.driverId },
            });

            const totalRating = allDriverRatings.reduce((sum, r) => sum + r.rating, 0);
            const averageRating = Math.round((totalRating / allDriverRatings.length) * 10) / 10;

            await prisma.driver.update({
                where: { userId: ride.driverId },
                data: {
                    rating: averageRating,
                    ratingCount: allDriverRatings.length,
                },
            });

            res.status(201).json({
                rating: newRating,
                driverRating: {
                    average: averageRating,
                    count: allDriverRatings.length,
                },
            });
        } else {
            res.status(201).json({
                rating: newRating,
                driverRating: null,
            });
        }
    } catch (error: any) {
        // The database unique constraint is the final guard against simultaneous
        // duplicate submissions for the same ride and passenger.
        if (error?.code === 'P2002') {
            return res.status(409).json({ error: 'This completed ride has already been rated' });
        }
        console.error('Create rating error:', error);
        res.status(500).json({ error: 'Failed to save rating' });
    }
});

export default router;
