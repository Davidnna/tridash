import { Request, Response, NextFunction } from 'express';
import prisma from '../utils/database';
import { getCookie, digestHex } from '../utils/crypto';

export interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
        name: string;
        role: string;
        isSuperAdmin?: boolean;
    };
}

export async function getCurrentUser(req: Request) {
    const token = getCookie(req, 'tridash_session');
    if (!token) return null;

    const tokenHash = await digestHex(token);

    const session = await prisma.session.findFirst({
        where: {
            tokenHash,
            expiresAt: {
                gt: new Date(),
            },
        },
        include: {
            user: true,
        },
    });

    if (!session) return null;
    return session.user;
}

export function requireAuth() {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        try {
            const user = await getCurrentUser(req);

            if (!user || !user.firebaseUid) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            if (!user.emailVerified) {
                return res.status(403).json({
                    error: 'Please verify your email address before using Tridash'
                });
            }

            if ((user as any).status === 'suspended') {
                return res.status(403).json({
                    error: 'Your Tridash account is suspended. Contact an administrator for assistance.'
                });
            }

            req.user = {
                userId: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                isSuperAdmin: user.isSuperAdmin,
            };

            next();
        } catch (error) {
            console.error('Auth middleware error:', error);
            res.status(500).json({ error: 'Authentication failed' });
        }
    };
}

export function requireRole(role: string) {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.user.role !== role && !req.user.isSuperAdmin) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        next();
    };
}

export function requireAdmin() {
    return requireRole('admin');
}

export function requireDriver() {
    return requireRole('driver');
}
