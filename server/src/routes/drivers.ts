import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, requireDriver, AuthenticatedRequest } from '../middleware/auth';
import { notifySubscribers } from '../services/websocket';

const router = Router();

// Get all drivers (public)
router.get('/', requireAuth(), async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ drivers });
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ error: 'Failed to get drivers' });
  }
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
      if (typeof verified === 'boolean') updateData.verified = verified;
      if (['active', 'suspended', 'pending'].includes(status)) updateData.status = status;
    } else {
      // Driver can only toggle online status
      if (typeof online === 'boolean') updateData.online = online;
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
