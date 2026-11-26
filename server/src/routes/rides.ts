import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { notifySubscribers } from '../services/websocket';
import { notifyUser, notifyUsers } from '../services/notifications';
import { getServiceStatus } from '../utils/config';
import { calculateFareFromDistance, getRouteDistanceMeters } from '../services/fare';

const router = Router();

// Get all rides (filtered by user role)
router.get('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let rides;

        if (user.role === 'admin') {
            rides = await prisma.ride.findMany({
                take: 50,
                orderBy: { requestedAt: 'desc' },
            });
        } else if (user.role === 'driver') {
            const [requestedRides, assignedRides] = await Promise.all([
                prisma.ride.findMany({
                    where: { status: 'Requested', driverId: null },
                    take: 50,
                    orderBy: { requestedAt: 'desc' },
                }),
                prisma.ride.findMany({
                    where: { driverId: user.id },
                    take: 50,
                    orderBy: { requestedAt: 'desc' },
                }),
            ]);
            const assignedIds = new Set(assignedRides.map(ride => ride.id));
            rides = [
                ...assignedRides,
                ...requestedRides.filter(ride => !assignedIds.has(ride.id)).map(ride => ({
                    ...ride,
                    passengerPhone: null,
                    riderPhone: null,
                })),
            ].sort((first, second) => second.requestedAt.getTime() - first.requestedAt.getTime()).slice(0, 100);
        } else {
            rides = await prisma.ride.findMany({
                where: { passengerId: user.id },
                take: 50,
                orderBy: { requestedAt: 'desc' },
            });
        }

        res.json({ rides });
    } catch (error) {
        console.error('Get rides error:', error);
        res.status(500).json({ error: 'Failed to get rides' });
    }
});

// Create new ride
router.post('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        // Passenger and admin accounts may create ride requests. Drivers use the
        // driver workspace to accept and manage rides, not request passenger trips.
        if (!['passenger', 'admin'].includes(req.user!.role)) {
            return res.status(403).json({ error: 'Only passenger or admin accounts can request rides' });
        }

        if (await getServiceStatus() === 'paused') {
            return res.status(503).json({ error: 'Tridash ride requests are temporarily paused. Please try again later.' });
        }

        const { pickup, destination, amount: quotedAmount, riderPhone, passengerPhone, riderName, passenger, bookedForSelf, pickupCoords, destinationCoords } = req.body;
        const paymentMethod = String(req.body?.paymentMethod || 'Cash');
        if (!['Cash', 'Paystack'].includes(paymentMethod)) {
            return res.status(400).json({ error: 'Choose a supported payment method: Cash or Paystack' });
        }

        const profile = await prisma.profile.findUnique({
            where: { userId: req.user!.userId },
        });

        const finalRiderPhone = String(riderPhone || passengerPhone || profile?.phone || '').trim();
        const finalRiderName = String(riderName || passenger || profile?.name || 'Passenger').trim();

        if (finalRiderPhone.length < 7) {
            return res.status(400).json({ error: 'Passenger phone number is required before booking' });
        }

        if (finalRiderName.length < 2) {
            return res.status(400).json({ error: 'Passenger name is required before booking' });
        }

        const pickupLocation = String(pickup || '').trim();
        const destinationLocation = String(destination || '').trim();
        if (pickupLocation.length < 2 || destinationLocation.length < 2) {
            return res.status(400).json({ error: 'Pickup and destination are required' });
        }

        const normalizedPickupCoords = pickupCoords && typeof pickupCoords === 'object'
            ? { lat: Number(pickupCoords.lat), lng: Number(pickupCoords.lng) }
            : null;
        const normalizedDestinationCoords = destinationCoords && typeof destinationCoords === 'object'
            ? { lat: Number(destinationCoords.lat), lng: Number(destinationCoords.lng) }
            : null;
        if (!normalizedPickupCoords || !normalizedDestinationCoords) {
            return res.status(400).json({ error: 'Select a valid pickup and destination from the map so Tridash can calculate the route fare.' });
        }
        const distanceMeters = await getRouteDistanceMeters(normalizedPickupCoords, normalizedDestinationCoords);
        const fare = await calculateFareFromDistance(distanceMeters);
        const fareAmount = fare.amount;
        if (!Number.isInteger(Number(quotedAmount)) || Number(quotedAmount) !== fareAmount) {
            return res.status(409).json({ error: 'The fare has changed. Find the route again to review the current fare before requesting your ride.' });
        }

        const ride = await prisma.ride.create({
            data: {
                passengerId: req.user!.userId,
                passenger: finalRiderName.slice(0, 120),
                passengerPhone: finalRiderPhone.slice(0, 40),
                riderName: finalRiderName.slice(0, 120),
                riderPhone: finalRiderPhone.slice(0, 40),
                bookedForSelf: bookedForSelf !== false,
                pickup: pickupLocation.slice(0, 300),
                destination: destinationLocation.slice(0, 300),
                pickupCoords: normalizedPickupCoords,
                destinationCoords: normalizedDestinationCoords,
                amount: fareAmount,
                status: 'Requested',
                paymentStatus: 'Pending',
                paymentMethod,
            },
        });

        // Notify currently available drivers. Detailed matching can be layered on later.
        await notifySubscribers('rides', ride.id, ride);
        const availableDrivers = await prisma.driver.findMany({
            where: { verified: true, online: true, status: 'active', user: { is: { status: 'active' } }, tricycles: { some: { status: 'active', verificationStatus: 'verified' } } },
            select: { userId: true },
        });
        await notifyUsers(availableDrivers.map(driver => driver.userId), 'New ride request', `${ride.pickup} to ${ride.destination} · ₦${ride.amount.toLocaleString()}`, '/driver/requests');

        res.status(201).json({ ride });
    } catch (error: any) {
        const status = Number(error?.statusCode) || 500;
        if (status === 500) console.error('Create ride error:', error);
        res.status(status).json({ error: error?.message || 'Failed to create ride' });
    }
});

// Accept ride (driver)
router.post('/:id/accept', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
        });

        if (!user || user.role !== 'driver') {
            return res.status(403).json({ error: 'Driver access required' });
        }
        if (await getServiceStatus() === 'paused') {
            return res.status(503).json({ error: 'Tridash has temporarily paused new ride assignments.' });
        }

        const driver = await prisma.driver.findUnique({
            where: { userId: user.id },
        });

        if (!driver) {
            return res.status(404).json({ error: 'Driver profile not found' });
        }

        if (!driver.verified || driver.status !== 'active' || !driver.online) {
            return res.status(403).json({ error: 'You must be a verified online driver to accept rides' });
        }
        const activeVehicle = await prisma.tricycle.findFirst({
            where: { driverId: driver.userId, status: 'active', verificationStatus: 'verified' },
            select: { id: true },
        });
        if (!activeVehicle) {
            return res.status(403).json({ error: 'An active, verified tricycle is required before accepting rides.' });
        }

        if (!driver.phone || driver.phone.trim().length < 7) {
            return res.status(400).json({ error: 'Add your phone number to your driver profile before accepting rides' });
        }

        const ride = await prisma.ride.findUnique({
            where: { id: String(req.params.id) },
        });

        if (!ride || ride.status !== 'Requested') {
            return res.status(409).json({
                error: ride?.status === 'Cancelled'
                    ? 'Passenger cancelled this ride'
                    : ride?.driverId
                        ? 'Ride has already been accepted by another driver'
                        : 'Ride is no longer available',
            });
        }

        if (ride.paymentMethod !== 'Cash' && (!driver.payoutSubaccountCode || !driver.payoutAccountNumber || !driver.payoutBankCode)) {
            return res.status(403).json({ error: 'This passenger selected online payment. Add and verify a payout account before accepting this ride, or ask the passenger to request a cash ride.' });
        }

        const passengerProfile = await prisma.profile.findUnique({
            where: { userId: ride.passengerId },
        });

        // Claim the request atomically. Only one driver can transition a requested,
        // unassigned ride to Accepted, even when multiple drivers race to accept it.
        const claim = await prisma.ride.updateMany({
            where: {
                id: String(req.params.id),
                status: 'Requested',
                driverId: null,
            },
            data: {
                driverId: user.id,
                driver: driver.name,
                driverPhone: driver.phone,
                tricycle: driver.tricycle,
                driverVehicleMake: driver.vehicleMake,
                driverVehicleModel: driver.vehicleModel,
                driverVehicleColor: driver.vehicleColor,
                passengerPhone: ride.riderPhone || ride.passengerPhone || passengerProfile?.phone || '',
                status: 'Accepted',
                acceptedAt: new Date(),
            },
        });

        if (claim.count !== 1) {
            const latestRide = await prisma.ride.findUnique({ where: { id: String(req.params.id) } });
            return res.status(409).json({
                error: latestRide?.status === 'Cancelled'
                    ? 'Passenger cancelled this ride'
                    : latestRide?.driverId
                        ? 'Ride has already been accepted by another driver'
                        : 'Ride is no longer available',
            });
        }

        const updatedRide = await prisma.ride.findUnique({
            where: { id: String(req.params.id) },
        });

        if (!updatedRide) {
            return res.status(404).json({ error: 'Ride not found after acceptance' });
        }

        // Notify subscribers only after the atomic claim succeeds.
        await notifySubscribers('rides', updatedRide.id, updatedRide);
        await notifyUser(updatedRide.passengerId, 'Driver assigned', `${updatedRide.driver || 'A verified driver'} accepted your ride request.`, `/trips/${updatedRide.id}`);

        res.json({ ride: updatedRide });
    } catch (error) {
        console.error('Accept ride error:', error);
        res.status(500).json({ error: 'Failed to accept ride' });
    }
});

// Reject ride (driver)
router.post('/:id/reject', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
        });

        if (!user || user.role !== 'driver') {
            return res.status(403).json({ error: 'Driver access required' });
        }

        const driver = await prisma.driver.findUnique({
            where: { userId: user.id },
        });

        if (!driver || !driver.verified || driver.status === 'suspended' || !driver.online) {
            return res.status(403).json({ error: 'You must be a verified online driver to reject rides' });
        }

        const ride = await prisma.ride.findUnique({
            where: { id: String(req.params.id) },
        });

        if (!ride || ride.status !== 'Requested') {
            return res.status(409).json({ error: 'Ride is no longer available' });
        }

        const rejectedIds = Array.from(new Set([...ride.rejectedByDriverIds, user.id]));

        const updatedRide = await prisma.ride.update({
            where: { id: String(req.params.id) },
            data: {
                rejectedByDriverIds: rejectedIds,
                lastRejectedAt: new Date(),
            },
        });

        // Notify subscribers
        await notifySubscribers('rides', updatedRide.id, updatedRide);

        res.json({ ride: updatedRide });
    } catch (error) {
        console.error('Reject ride error:', error);
        res.status(500).json({ error: 'Failed to reject ride' });
    }
});

// Update ride
router.put('/:id', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        const ride = await prisma.ride.findUnique({
            where: { id: String(req.params.id) },
        });

        if (!ride) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user!.userId },
        });

        if (!user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const isDriver = user.role === 'driver';
        const isAdmin = user.role === 'admin';

        // Passengers must use the dedicated cancellation endpoint; they may never
        // mutate ride status, assignment, fare, payment state, or contact records.
        if (!isDriver && !isAdmin) {
            return res.status(403).json({ error: 'Only the assigned driver or an administrator can update this ride' });
        }

        if (isDriver && ride.driverId !== user.id) {
            return res.status(403).json({ error: 'Only the assigned driver can update this ride' });
        }

        const requestedStatus = String(req.body?.status || '');
        const validDriverTransition =
            (ride.status === 'Accepted' && requestedStatus === 'In Progress') ||
            (ride.status === 'In Progress' && requestedStatus === 'Completed');
        const validAdminTransition =
            requestedStatus === 'Cancelled' &&
            !['Completed', 'Cancelled'].includes(ride.status);

        if ((isDriver && !validDriverTransition) || (isAdmin && !validAdminTransition)) {
            return res.status(409).json({ error: 'Invalid ride status transition' });
        }

        // Ignore every client-supplied field except the validated status. The
        // conditional update also prevents stale requests overwriting a newer state.
        const updateResult = await prisma.ride.updateMany({
            where: {
                id: String(req.params.id),
                status: ride.status,
                ...(isDriver ? { driverId: user.id } : {}),
            },
            data: {
                status: requestedStatus,
                ...(requestedStatus === 'In Progress' ? { startedAt: new Date() } : {}),
                ...(requestedStatus === 'Completed' ? { completedAt: new Date() } : {}),
                ...(requestedStatus === 'Cancelled' ? { cancelledAt: new Date() } : {}),
            },
        });

        if (updateResult.count !== 1) {
            return res.status(409).json({ error: 'This ride changed before your update could be saved. Refresh and try again.' });
        }

        const updatedRide = await prisma.ride.findUnique({
            where: { id: String(req.params.id) },
        });

        if (!updatedRide) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        // Notify subscribers and the passenger only after a successful state transition.
        await notifySubscribers('rides', updatedRide.id, updatedRide);
        const statusMessage = requestedStatus === 'In Progress'
            ? 'Your driver has started the trip.'
            : 'Your trip has been completed.';
        await notifyUser(updatedRide.passengerId, requestedStatus === 'In Progress' ? 'Trip started' : 'Trip completed', statusMessage, `/trips/${updatedRide.id}`);

        res.json({ ride: updatedRide });
    } catch (error) {
        console.error('Update ride error:', error);
        res.status(500).json({ error: 'Failed to update ride' });
    }
});


// Driver confirms receipt of a cash fare after a completed trip.
router.post('/:id/cash-payment/confirm', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        if (req.user!.role !== 'driver') {
            return res.status(403).json({ error: 'Only the assigned driver can confirm cash collection' });
        }
        const rideId = String(req.params.id);
        const result = await prisma.$transaction(async tx => {
            const ride = await tx.ride.findUnique({ where: { id: rideId } });
            if (!ride || ride.driverId !== req.user!.userId) {
                throw Object.assign(new Error('Ride not found or not assigned to this driver'), { statusCode: 404 });
            }
            if (ride.status !== 'Completed' || ride.paymentMethod !== 'Cash') {
                throw Object.assign(new Error('Only completed cash rides can be confirmed'), { statusCode: 409 });
            }
            if (ride.paymentStatus === 'Paid') {
                throw Object.assign(new Error('Cash payment has already been confirmed'), { statusCode: 409 });
            }
            const cashUpdate = await tx.ride.updateMany({
                where: { id: rideId, driverId: req.user!.userId, status: 'Completed', paymentMethod: 'Cash', paymentStatus: { not: 'Paid' } },
                data: { paymentStatus: 'Paid', paymentReference: `CASH-${rideId}` },
            });
            if (cashUpdate.count !== 1) {
                throw Object.assign(new Error('Cash payment has already been confirmed or the ride changed'), { statusCode: 409 });
            }
            const payment = await tx.payment.upsert({
                where: { reference: `CASH-${rideId}` },
                create: {
                    rideId,
                    userId: ride.passengerId,
                    amount: ride.amount,
                    method: 'Cash',
                    status: 'Paid',
                    reference: `CASH-${rideId}`,
                    paidAt: new Date(),
                },
                update: { status: 'Paid', paidAt: new Date() },
            });
            const updatedRide = await tx.ride.findUnique({ where: { id: rideId } });
            return { ride: updatedRide, payment };
        });
        if (result.ride) {
            await notifyUser(result.ride.passengerId, 'Cash fare confirmed', 'Your driver confirmed receiving the cash fare for this trip.', `/trips/${result.ride.id}`);
            await notifySubscribers('rides', result.ride.id, result.ride);
        }
        res.json(result);
    } catch (error: any) {
        const status = Number(error?.statusCode) || 500;
        if (status === 500) console.error('Cash payment confirmation error:', error);
        res.status(status).json({ error: error?.message || 'Could not confirm cash payment' });
    }
});

// Cancel ride (passenger)
router.post('/:id/cancel', requireAuth(), async (req: AuthenticatedRequest, res) => {
    try {
        if (req.user!.role !== 'passenger') {
            return res.status(403).json({ error: 'Only passenger accounts can cancel rides' });
        }

        const ride = await prisma.ride.findUnique({
            where: { id: String(req.params.id) },
        });

        if (!ride || ride.passengerId !== req.user!.userId) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        if (['Completed', 'Cancelled'].includes(ride.status)) {
            return res.status(409).json({ error: 'This ride can no longer be cancelled' });
        }

        // Claim cancellation only while the ride is still cancellable. This prevents
        // a stale cancellation request from overwriting a driver's completion update.
        const cancellation = await prisma.ride.updateMany({
            where: {
                id: String(req.params.id),
                passengerId: req.user!.userId,
                status: { in: ['Requested', 'Accepted', 'In Progress'] },
            },
            data: {
                status: 'Cancelled',
                cancelledAt: new Date(),
            },
        });

        if (cancellation.count !== 1) {
            return res.status(409).json({ error: 'This ride has changed and can no longer be cancelled. Refresh your trips.' });
        }

        const updatedRide = await prisma.ride.findUnique({ where: { id: String(req.params.id) } });
        if (!updatedRide) return res.status(404).json({ error: 'Ride not found' });

        // Notify subscribers and the assigned driver only after the cancellation succeeds.
        await notifySubscribers('rides', updatedRide.id, updatedRide);
        if (updatedRide.driverId) {
            await notifyUser(updatedRide.driverId, 'Ride cancelled', 'The passenger cancelled this ride.', '/driver');
        }

        res.json({ ride: updatedRide });
    } catch (error) {
        console.error('Cancel ride error:', error);
        res.status(500).json({ error: 'Failed to cancel ride' });
    }
});

export default router;
