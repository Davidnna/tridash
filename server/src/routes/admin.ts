import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { getFirebaseAuth } from '../utils/firebase';

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
