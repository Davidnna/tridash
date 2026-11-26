/// <reference types="vite/client" />

// Vite exposes build-time variables on import.meta.env. Declaring the keys the
// app reads keeps `import.meta.env.VITE_*` typed instead of `any`.
interface ImportMetaEnv {
    readonly VITE_API_URL?: string;
    readonly VITE_FIREBASE_API_KEY?: string;
    readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
    readonly VITE_FIREBASE_PROJECT_ID?: string;
    readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
    readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
    readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
interface ImportMetaEnv {
    readonly VITE_FIREBASE_VAPID_KEY?: string;
}
