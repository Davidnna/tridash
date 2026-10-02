import { Router } from 'express';
import prisma from '../utils/database';
import { getFirebaseAuth } from '../utils/firebase';
import { getCurrentUser } from '../middleware/auth';
import { digestHex, makeSessionToken, setCookieHeader, clearCookieHeader, getCookie } from '../utils/crypto';

const router = Router();

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'davedozie1@gmail.com';

// Firebase session creation
router.post('/firebase-session', async (req, res) => {
  try {
    const { idToken, role } = req.body;
    const requestedRole = role === 'driver' ? 'driver' : 'passenger';

    if (!idToken) {
      return res.status(400).json({ error: 'Firebase ID token is required' });
    }

    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      return res.status(500).json({ error: 'Firebase authentication is not configured' });
    }

    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const email = String(decoded.email || '').trim().toLowerCase();

    if (!decoded.uid || !email) {
      return res.status(400).json({ error: 'Firebase account must have an email address' });
    }

    if (!decoded.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before using Tridash' });
    }

    let user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });

    const now = new Date();

    if (!user) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingByEmail?.firebaseUid && existingByEmail.firebaseUid !== decoded.uid) {
        return res.status(409).json({ error: 'This email is already linked to another Tridash identity' });
      }

      const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
      const userRole = isSuperAdmin ? 'admin' : requestedRole;

      const userData = {
        firebaseUid: decoded.uid,
        email,
        name: String(decoded.name || email.split('@')[0]),
        role: userRole,
        emailVerified: true,
        isSuperAdmin,
      };

      if (existingByEmail) {
        user = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: userData,
        });
      } else {
        user = await prisma.user.create({
          data: userData,
        });

        await prisma.profile.create({
          data: {
            userId: user.id,
            name: userData.name,
            phone: '',
            emergencyName: '',
            emergencyPhone: '',
            role: userRole,
          },
        });
      }
    } else {
      if ((user as any).status === 'suspended') {
        return res.status(403).json({ error: 'This Tridash account is suspended. Contact an administrator for assistance.' });
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          email,
          name: String(decoded.name || user.name || email.split('@')[0]),
          emailVerified: true,
        },
      });
    }

    // Set driver offline after login
    if (user.role === 'driver') {
      const driver = await prisma.driver.findUnique({
        where: { userId: user.id },
      });

      if (driver) {
        await prisma.driver.update({
          where: { id: driver.id },
          data: {
            online: false,
            lastLocation: { set: null },
          },
        });
      }
    }

    // Create session
    const token = makeSessionToken();
    const tokenHash = await digestHex(token);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.session.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    res.setHeader('Set-Cookie', setCookieHeader(token));
    res.json({
      user: {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
        isSuperAdmin: user.isSuperAdmin,
      },
    });
  } catch (error) {
    console.error('Firebase session error:', error);
    res.status(401).json({ error: 'Unable to verify your Firebase session' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user?.firebaseUid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await prisma.profile.findUnique({
      where: { userId: user.id },
    });

    res.json({
      user: {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
        isSuperAdmin: user.isSuperAdmin,
      },
      profile: profile || {
        userId: user.id,
        name: user.name,
        phone: '',
        emergencyName: '',
        emergencyPhone: '',
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Failed to get user information' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const token = getCookie(req, 'tridash_session');

    if (token) {
      const tokenHash = await digestHex(token);
      const session = await prisma.session.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (session) {
        // Set driver offline on logout
        if (session.user.role === 'driver') {
          const driver = await prisma.driver.findUnique({
            where: { userId: session.user.id },
          });

          if (driver) {
            await prisma.driver.update({
              where: { id: driver.id },
              data: {
                online: false,
                lastLocation: { set: null },
              },
            });
          }
        }

        await prisma.session.delete({
          where: { id: session.id },
        });
      }
    }

    res.setHeader('Set-Cookie', clearCookieHeader());
    res.json({ ok: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
