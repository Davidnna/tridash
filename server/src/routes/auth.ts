import { Router } from 'express';
import prisma from '../utils/database';
import { getFirebaseAuth } from '../utils/firebase';
import { getCurrentUser } from '../middleware/auth';
import { digestHex, makeSessionToken, setCookieHeader, clearCookieHeader, getCookie } from '../utils/crypto';
import bcrypt from 'bcrypt';
import { sendAuthEmail, makeOneTimeToken, tokenExpiresAt } from '../utils/auth-email';

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


// Tridash-managed email/password and Google authentication.
// Legacy Firebase endpoints remain available during the staged account migration.

const normalizeEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const publicUser = (user: any) => ({
  userId: user.id, email: user.email, name: user.name, role: user.role,
  emailVerified: user.emailVerified, isSuperAdmin: user.isSuperAdmin,
});

async function createTridashSession(user: any, res: any) {
  const token = makeSessionToken();
  const tokenHash = await digestHex(token);
  await prisma.session.create({
    data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });
  res.setHeader('Set-Cookie', setCookieHeader(token));
}

async function setDriverOffline(user: any) {
  if (user.role !== 'driver') return;
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (driver) await prisma.driver.update({ where: { id: driver.id }, data: { online: false, lastLocation: { set: null } } });
}

router.post('/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Enter your name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Use a password between 10 and 128 characters.' });
    if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ error: 'An account already exists with this email. Sign in or use Google.' });
    const token = makeOneTimeToken();
    const passwordHash = await bcrypt.hash(password, 12);
    const isSuperAdmin = email === SUPER_ADMIN_EMAIL.toLowerCase();
    const requestedRole = req.body?.role === 'driver' ? 'driver' : 'passenger';
    const accountRole = isSuperAdmin ? 'admin' : requestedRole;
    const user = await prisma.user.create({
      data: {
        firebaseUid: null, email, name, role: accountRole,
        isSuperAdmin, emailVerified: false, passwordHash,
        emailVerificationTokenHash: await digestHex(token),
        emailVerificationExpiresAt: tokenExpiresAt(),
        profile: { create: { name, phone: '', emergencyName: '', emergencyPhone: '', role: accountRole } },
      },
    });
    try {
      await sendAuthEmail({ to: email, name, kind: 'verify', token });
    } catch (error) {
      await prisma.user.delete({ where: { id: user.id } });
      throw error;
    }
    res.status(201).json({ ok: true, message: 'Check your email for a verification link.' });
  } catch (error: any) {
    console.error('Tridash registration failed:', error);
    res.status(500).json({ error: error?.message || 'Registration could not be completed.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'The email or password is incorrect.' });
    }
    if (!user.emailVerified) return res.status(403).json({ error: 'Please verify your email before signing in.' });
    if (user.status === 'suspended') return res.status(403).json({ error: 'Your Tridash account is suspended. Contact support.' });
    await setDriverOffline(user);
    await createTridashSession(user, res);
    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    res.json({ user: publicUser(user), profile });
  } catch (error) {
    console.error('Tridash login failed:', error);
    res.status(500).json({ error: 'Sign-in could not be completed.' });
  }
});

router.post('/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(503).json({ error: 'Google sign-in is not configured on the server.' });
    if (!credential) return res.status(400).json({ error: 'Google credential is required.' });
    const verifyResponse = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
    if (!verifyResponse.ok) return res.status(401).json({ error: 'Google could not verify this sign-in. Please try again.' });
    const claims: any = await verifyResponse.json();
    if (claims.aud !== clientId || claims.email_verified !== 'true' || !claims.sub || !claims.email) {
      return res.status(401).json({ error: 'Google account verification failed.' });
    }
    const email = normalizeEmail(claims.email);
    const googleSubject = String(claims.sub);
    const name = String(claims.name || email.split('@')[0]).slice(0, 100);
    let user = await prisma.user.findUnique({ where: { googleSubject } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        // Google has asserted ownership of this verified email; link without changing existing role/data.
        user = await prisma.user.update({ where: { id: user.id }, data: { googleSubject, emailVerified: true, name: user.name || name } });
      } else {
        const isSuperAdmin = email === SUPER_ADMIN_EMAIL.toLowerCase();
        const role = isSuperAdmin ? 'admin' : 'passenger';
        user = await prisma.user.create({
          data: {
            firebaseUid: null, googleSubject, email, name, role, isSuperAdmin, emailVerified: true,
            profile: { create: { name, phone: '', emergencyName: '', emergencyPhone: '', role } },
          },
        });
      }
    }
    if (user.status === 'suspended') return res.status(403).json({ error: 'Your Tridash account is suspended. Contact support.' });
    await setDriverOffline(user);
    await createTridashSession(user, res);
    const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    res.json({ user: publicUser(user), profile });
  } catch (error) {
    console.error('Tridash Google sign-in failed:', error);
    res.status(500).json({ error: 'Google sign-in could not be completed.' });
  }
});

router.get('/verify-email', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    if (!token) return res.status(400).json({ error: 'Verification link is invalid or expired.' });
    const tokenHash = await digestHex(token);
    const user = await prisma.user.findFirst({ where: { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: { gt: new Date() } } });
    if (!user) return res.status(400).json({ error: 'Verification link is invalid or expired. Request a new one.' });
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true, emailVerificationTokenHash: null, emailVerificationExpiresAt: null } });
    res.json({ ok: true, message: 'Your email is verified. You can now sign in.' });
  } catch (error) {
    console.error('Email verification failed:', error);
    res.status(500).json({ error: 'Email verification could not be completed.' });
  }
});

router.post('/resend-verification', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      const token = makeOneTimeToken();
      await prisma.user.update({ where: { id: user.id }, data: { emailVerificationTokenHash: await digestHex(token), emailVerificationExpiresAt: tokenExpiresAt() } });
      await sendAuthEmail({ to: email, name: user.name, kind: 'verify', token });
    }
    res.json({ ok: true, message: 'If the account needs verification, an email will be sent.' });
  } catch (error) {
    console.error('Resend verification failed:', error);
    res.status(500).json({ error: 'Verification email could not be sent.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && (user.passwordHash || user.firebaseUid)) {
      const token = makeOneTimeToken();
      await prisma.user.update({ where: { id: user.id }, data: { passwordResetTokenHash: await digestHex(token), passwordResetExpiresAt: tokenExpiresAt() } });
      await sendAuthEmail({ to: email, name: user.name, kind: 'reset', token });
    }
    res.json({ ok: true, message: 'If an account can reset its password, a reset link will be sent.' });
  } catch (error) {
    console.error('Forgot password failed:', error);
    res.status(500).json({ error: 'Password reset email could not be sent.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Use a password between 10 and 128 characters.' });
    const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: await digestHex(token), passwordResetExpiresAt: { gt: new Date() } } });
    if (!user) return res.status(400).json({ error: 'Password reset link is invalid or expired.' });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 12), firebaseUid: null, emailVerified: true, passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    res.json({ ok: true, message: 'Password updated. Please sign in.' });
  } catch (error) {
    console.error('Password reset failed:', error);
    res.status(500).json({ error: 'Password reset could not be completed.' });
  }
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
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
