import { Router } from 'express';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { createAuthToken, hashAuthToken, sendVerificationEmail, sendPasswordResetEmail } from '../services/authEmail';
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


// Tridash-owned authentication: Google Identity Services + local password credentials.
// Keep the legacy Firebase endpoint during the staged migration; the new frontend
// will use these endpoints after required Google/email secrets are configured.
const googleClient = new OAuth2Client();

async function createTridashSession(userId: string, res: any) {
  const token = makeSessionToken();
  const tokenHash = await digestHex(token);
  await prisma.session.create({
    data: { tokenHash, userId, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });
  res.setHeader('Set-Cookie', setCookieHeader(token));
}

function publicUser(user: any) {
  return {
    userId: user.id, email: user.email, name: user.name, role: user.role,
    emailVerified: user.emailVerified, isSuperAdmin: user.isSuperAdmin,
  };
}

async function ensureProfile(user: any) {
  await prisma.profile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, name: user.name, phone: '', emergencyName: '', emergencyPhone: '', role: user.role },
    update: {},
  });
}

router.post('/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '');
    const requestedRole = req.body?.role === 'driver' ? 'driver' : 'passenger';
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(503).json({ error: 'Google sign-in is not configured yet.' });
    if (!credential) return res.status(400).json({ error: 'Google credential is required.' });

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      return res.status(401).json({ error: 'Google could not verify this account email.' });
    }
    const email = payload.email.trim().toLowerCase();
    const googleSub = payload.sub;
    let user = await prisma.user.findUnique({ where: { googleSub } });
    if (!user) {
      const existing = await prisma.user.findUnique({ where: { email } });
      const isSuperAdmin = email === SUPER_ADMIN_EMAIL.toLowerCase();
      const role = isSuperAdmin ? 'admin' : (existing?.role || requestedRole);
      if (existing) {
        if ((existing as any).status === 'suspended') return res.status(403).json({ error: 'This Tridash account is suspended. Contact an administrator.' });
        user = await prisma.user.update({
          where: { id: existing.id },
          data: { googleSub, firebaseUid: null, emailVerified: true, name: String(payload.name || existing.name), isSuperAdmin: existing.isSuperAdmin || isSuperAdmin, role },
        });
      } else {
        user = await prisma.user.create({
          data: { googleSub, email, name: String(payload.name || email.split('@')[0]), role, emailVerified: true, isSuperAdmin },
        });
      }
    } else {
      if ((user as any).status === 'suspended') return res.status(403).json({ error: 'This Tridash account is suspended. Contact an administrator.' });
      user = await prisma.user.update({ where: { id: user.id }, data: { email, name: String(payload.name || user.name), emailVerified: true } });
    }
    await ensureProfile(user);
    await createTridashSession(user.id, res);
    if (user.role === 'driver') {
      await prisma.driver.updateMany({ where: { userId: user.id }, data: { online: false, lastLocation: { set: null } } });
    }
    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    return res.json({ user: publicUser(user), profile });
  } catch (error) {
    console.error('Google sign-in failed:', error);
    return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const requestedRole = req.body?.role === 'driver' ? 'driver' : 'passenger';
    if (name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account may already exist for this email. Try signing in or resetting your password.' });
    const isSuperAdmin = email === SUPER_ADMIN_EMAIL.toLowerCase();
    const role = isSuperAdmin ? 'admin' : requestedRole;
    const user = await prisma.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 12), role, emailVerified: false, isSuperAdmin },
    });
    await ensureProfile(user);
    const { token, tokenHash } = createAuthToken();
    await prisma.authToken.create({ data: { tokenHash, userId: user.id, type: 'email_verification', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
    try {
      await sendVerificationEmail(email, token);
    } catch (emailError) {
      await prisma.authToken.deleteMany({ where: { userId: user.id, type: 'email_verification' } });
      await prisma.user.delete({ where: { id: user.id } });
      throw emailError;
    }
    return res.status(201).json({ ok: true, message: 'Account created. Check your email for a verification link.' });
  } catch (error: any) {
    console.error('Tridash signup failed:', error);
    return res.status(500).json({ error: error?.message || 'Account creation failed. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Email or password is incorrect. If you previously used Firebase, reset your password to move your account to Tridash sign-in.' });
    }
    if ((user as any).status === 'suspended') return res.status(403).json({ error: 'This Tridash account is suspended. Contact an administrator.' });
    if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email address before signing in.' });
    await createTridashSession(user.id, res);
    if (user.role === 'driver') await prisma.driver.updateMany({ where: { userId: user.id }, data: { online: false, lastLocation: { set: null } } });
    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    return res.json({ user: publicUser(user), profile });
  } catch (error) {
    console.error('Tridash login failed:', error);
    return res.status(500).json({ error: 'Sign-in failed. Please try again.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const genericMessage = 'If an account exists for that email, we will send password-reset instructions.';
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !(user as any).googleSub) {
      await prisma.authToken.deleteMany({ where: { userId: user.id, type: 'password_reset' } });
      const { token, tokenHash } = createAuthToken();
      await prisma.authToken.create({ data: { tokenHash, userId: user.id, type: 'password_reset', expiresAt: new Date(Date.now() + 60 * 60 * 1000) } });
      await sendPasswordResetEmail(email, token);
    }
  } catch (error) {
    console.error('Password reset email request failed:', error);
  }
  return res.json({ ok: true, message: genericMessage });
});

router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 10) return res.status(400).json({ error: 'Use a password with at least 10 characters.' });
    const tokenHash = hashAuthToken(token);
    const authToken = await prisma.authToken.findFirst({ where: { tokenHash, type: 'password_reset', expiresAt: { gt: new Date() } } });
    if (!authToken) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: authToken.userId }, data: { passwordHash: bcrypt.hashSync(password, 12), firebaseUid: null } }),
      prisma.authToken.deleteMany({ where: { userId: authToken.userId, type: 'password_reset' } }),
      prisma.session.deleteMany({ where: { userId: authToken.userId } }),
    ]);
    return res.json({ ok: true, message: 'Password updated. You can now sign in to Tridash.' });
  } catch (error) {
    console.error('Password reset failed:', error);
    return res.status(500).json({ error: 'Password could not be updated. Request a new reset link.' });
  }
});

router.post('/verify-email', async (req, res) => {
  try {
    const tokenHash = hashAuthToken(String(req.body?.token || ''));
    const authToken = await prisma.authToken.findFirst({ where: { tokenHash, type: 'email_verification', expiresAt: { gt: new Date() } } });
    if (!authToken) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
    await prisma.$transaction([
      prisma.user.update({ where: { id: authToken.userId }, data: { emailVerified: true } }),
      prisma.authToken.deleteMany({ where: { userId: authToken.userId, type: 'email_verification' } }),
    ]);
    return res.json({ ok: true, message: 'Email verified. You can now sign in.' });
  } catch (error) {
    console.error('Email verification failed:', error);
    return res.status(500).json({ error: 'Email verification could not be completed.' });
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
