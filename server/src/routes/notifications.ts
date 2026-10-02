import { Router } from 'express';
import prisma from '../utils/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Get notifications for current user
router.get('/', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ notifications });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Mark notification as read
router.post('/:id/read', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const notification = await prisma.notification.findUnique({
      where: { id: String(req.params.id) },
    });

    if (!notification || notification.userId !== req.user!.userId) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    if (notification.read) {
      return res.json({ notification });
    }

    const updatedNotification = await prisma.notification.update({
      where: { id: String(req.params.id) },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    res.json({ notification: updatedNotification });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Mark all notifications as read
router.post('/read-all', requireAuth(), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId: req.user!.userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    res.json({ updated: result.count });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

export default router;
