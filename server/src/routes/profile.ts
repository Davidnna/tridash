import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Get user profile
router.get('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    const profile = await prisma.profile.findUnique({
      where: { userId: req.user!.userId },
    });

    res.json({
      profile: profile || {
        userId: req.user!.userId,
        name: user?.name || 'Passenger',
        phone: '',
        emergencyName: '',
        emergencyPhone: '',
        role: user?.role || 'passenger',
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// Create or update profile
router.post('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
    });

    const { name, phone, emergencyName, emergencyPhone } = req.body;

    const existing = await prisma.profile.findUnique({
      where: { userId: req.user!.userId },
    });

    const profileData = {
      name: typeof name === 'string' ? name.trim().slice(0, 120) : (existing?.name || user?.name || 'Passenger'),
      phone: typeof phone === 'string' ? phone.trim().slice(0, 40) : (existing?.phone || ''),
      emergencyName: typeof emergencyName === 'string' ? emergencyName.trim().slice(0, 120) : (existing?.emergencyName || ''),
      emergencyPhone: typeof emergencyPhone === 'string' ? emergencyPhone.trim().slice(0, 40) : (existing?.emergencyPhone || ''),
      userId: req.user!.userId,
      role: user?.role || 'passenger',
    };

    let profile;

    if (existing) {
      profile = await prisma.profile.update({
        where: { id: existing.id },
        data: profileData,
      });
    } else {
      profile = await prisma.profile.create({
        data: profileData,
      });
    }

    res.status(existing ? 200 : 201).json({ profile });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

export default router;
