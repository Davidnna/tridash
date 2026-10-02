import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { notifySubscribers } from '../services/websocket';

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
      rides = await prisma.ride.findMany({
        where: {
          OR: [
            { status: 'Requested' },
            { driverId: user.id },
          ],
        },
        take: 50,
        orderBy: { requestedAt: 'desc' },
      });
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
    const { pickup, destination, amount, riderPhone, passengerPhone, riderName, passenger, bookedForSelf, pickupCoords, destinationCoords } = req.body;

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

    if (!pickup || !destination || pickup.length < 2 || destination.length < 2) {
      return res.status(400).json({ error: 'Pickup and destination are required' });
    }

    const fareAmount = Number(amount);
    if (!Number.isInteger(fareAmount) || fareAmount < 800 || fareAmount > 100000) {
      return res.status(400).json({ error: 'Ride fare is invalid' });
    }

    const ride = await prisma.ride.create({
      data: {
        passengerId: req.user!.userId,
        passenger: finalRiderName.slice(0, 120),
        passengerPhone: finalRiderPhone.slice(0, 40),
        riderName: finalRiderName.slice(0, 120),
        riderPhone: finalRiderPhone.slice(0, 40),
        bookedForSelf: bookedForSelf !== false,
        pickup: pickup.slice(0, 300),
        destination: destination.slice(0, 300),
        pickupCoords: pickupCoords || null,
        destinationCoords: destinationCoords || null,
        amount: fareAmount,
        status: 'Requested',
        paymentStatus: 'Pending',
        paymentMethod: 'Paystack',
      },
    });

    // Notify subscribers
    await notifySubscribers('rides', ride.id, ride);

    res.status(201).json({ ride });
  } catch (error) {
    console.error('Create ride error:', error);
    res.status(500).json({ error: 'Failed to create ride' });
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

    const driver = await prisma.driver.findUnique({
      where: { userId: user.id },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Driver profile not found' });
    }

    if (!driver.verified || driver.status === 'suspended' || !driver.online) {
      return res.status(403).json({ error: 'You must be a verified online driver to accept rides' });
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

    const passengerProfile = await prisma.profile.findUnique({
      where: { userId: ride.passengerId },
    });

    const updatedRide = await prisma.ride.update({
      where: { id: String(req.params.id) },
      data: {
        driverId: user.id,
        driver: driver.name,
        driverPhone: driver.phone,
        tricycle: driver.tricycle,
        passengerPhone: ride.riderPhone || ride.passengerPhone || passengerProfile?.phone || '',
        status: 'Accepted',
        acceptedAt: new Date(),
      },
    });

    // Notify subscribers
    await notifySubscribers('rides', updatedRide.id, updatedRide);

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

    const isPassenger = ride.passengerId === user.id;
    const isDriver = ride.driverId === user.id;
    const isAdmin = user.role === 'admin';

    if (!isPassenger && !isDriver && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let updateData = req.body;

    // Non-admin drivers can only update status
    if (user.role === 'driver' && !isAdmin) {
      if (ride.driverId !== user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const requestedStatus = String(req.body.status || ride.status);
      const validTransition =
        (ride.status === 'Accepted' && requestedStatus === 'In Progress') ||
        (ride.status === 'In Progress' && requestedStatus === 'Completed');

      if (!validTransition) {
        return res.status(409).json({ error: 'Invalid ride status transition' });
      }

      updateData = { status: requestedStatus };
    }

    const updatedRide = await prisma.ride.update({
      where: { id: String(req.params.id) },
      data: updateData,
    });

    // Notify subscribers
    await notifySubscribers('rides', updatedRide.id, updatedRide);

    res.json({ ride: updatedRide });
  } catch (error) {
    console.error('Update ride error:', error);
    res.status(500).json({ error: 'Failed to update ride' });
  }
});

// Cancel ride (passenger)
router.post('/:id/cancel', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const ride = await prisma.ride.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!ride || ride.passengerId !== req.user!.userId) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (['Completed', 'Cancelled'].includes(ride.status)) {
      return res.status(409).json({ error: 'This ride can no longer be cancelled' });
    }

    const updatedRide = await prisma.ride.update({
      where: { id: String(req.params.id) },
      data: {
        status: 'Cancelled',
        cancelledAt: new Date(),
      },
    });

    // Notify subscribers
    await notifySubscribers('rides', updatedRide.id, updatedRide);

    res.json({ ride: updatedRide });
  } catch (error) {
    console.error('Cancel ride error:', error);
    res.status(500).json({ error: 'Failed to cancel ride' });
  }
});

export default router;
