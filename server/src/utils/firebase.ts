import { initializeApp, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

let firebaseApp: App | null = null;

export function initializeFirebase() {
    if (firebaseApp) {
        return firebaseApp;
    }

    try {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\\\n/g, '\\n');

        if (!projectId || !clientEmail || !privateKey) {
            console.warn('⚠️  Firebase not configured - set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env');
            return null;
        }

        firebaseApp = initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey,
            }),
            projectId,
        });

        console.log('✅ Firebase Admin initialized');
        return firebaseApp;
    } catch (error) {
        console.error('❌ Firebase initialization failed:', error);
        return null;
    }
}

export function getFirebaseAuth() {
    if (!firebaseApp) {
        initializeFirebase();
    }
    return firebaseApp ? getAuth(firebaseApp) : null;
}

export default { initializeFirebase, getFirebaseAuth };

export function getFirebaseMessaging() {
    if (!firebaseApp) initializeFirebase();
    return firebaseApp ? getMessaging(firebaseApp) : null;
}
