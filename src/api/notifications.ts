import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { firebaseApp } from '../firebase';
import { api } from './client';

class NotificationsClient {
    private messagingPromise: Promise<ReturnType<typeof getMessaging> | null> | null = null;

    private async messaging() {
        if (!this.messagingPromise) {
            this.messagingPromise = isSupported().then(supported => supported ? getMessaging(firebaseApp) : null);
        }
        return this.messagingPromise;
    }

    async requestPermission(): Promise<boolean> {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;
        return (await Notification.requestPermission()) === 'granted';
    }

    async subscribe(): Promise<string> {
        const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
        if (!vapidKey) throw new Error('Push notifications are not configured for this deployment.');
        if (!(await this.requestPermission())) throw new Error('Notification permission was not granted.');
        const messaging = await this.messaging();
        if (!messaging) throw new Error('This browser does not support Firebase push notifications.');
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
        if (!token) throw new Error('The browser did not issue a push notification token.');
        await api.post('/api/notifications/device-token', { token, platform: 'web' });
        return token;
    }

    async unsubscribe(): Promise<void> {
        const messaging = await this.messaging();
        if (!messaging) return;
        const token = await getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY });
        if (token) await api.delete('/api/notifications/device-token', { token });
    }

    onForegroundMessage(callback: (payload: MessagePayload) => void) {
        let unsubscribe: (() => void) | null = null;
        void this.messaging().then(messaging => {
            if (messaging) unsubscribe = onMessage(messaging, callback);
        });
        return () => unsubscribe?.();
    }
}

export const notifications = new NotificationsClient();
export default NotificationsClient;
