import prisma from '../utils/database';
import { getFirebaseMessaging } from '../utils/firebase';

export async function notifyUser(userId: string, title: string, body: string, url = '/') {
    let notification = null;
    try {
        notification = await prisma.notification.create({
            data: { userId, title, body: body.slice(0, 500), url },
        });
    } catch (error) {
        console.error('In-app notification could not be stored:', error);
        return null;
    }

    try {
        const tokens = await prisma.pushToken.findMany({
            where: { userId },
            select: { token: true },
        });
        if (tokens.length) {
            const messaging = getFirebaseMessaging();
            if (!messaging) return notification;
            const result = await messaging.sendEachForMulticast({
                tokens: tokens.map(item => item.token),
                notification: { title, body: body.slice(0, 500) },
                data: { url },
                webpush: { fcmOptions: { link: url.startsWith('http') ? url : `${(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}` } },
            });
            const invalidTokens = result.responses.flatMap((response, index) => (
                !response.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(response.error?.code || '')
                    ? [tokens[index].token]
                    : []
            ));
            if (invalidTokens.length) {
                await prisma.pushToken.deleteMany({ where: { token: { in: invalidTokens } } });
            }
        }
    } catch (error) {
        // In-app notification persistence must not fail because push delivery is unavailable.
        console.error('Push notification delivery failed:', error);
    }

    return notification;
}

export async function notifyUsers(userIds: string[], title: string, body: string, url = '/') {
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    return Promise.all(uniqueIds.map(userId => notifyUser(userId, title, body, url)));
}
