importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyDXO7DEBPT_L868asqyae639sabQobQoAo',
    authDomain: 'tridash-e2a63.firebaseapp.com',
    projectId: 'tridash-e2a63',
    storageBucket: 'tridash-e2a63.firebasestorage.app',
    messagingSenderId: '764181163795',
    appId: '1:764181163795:web:43f83bf454e8dd5ed6b4e6',
    measurementId: 'G-DHH44PCWCN'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
    const title = payload.notification?.title || 'Tridash update';
    const options = {
        body: payload.notification?.body || 'You have a new update.',
        icon: '/favicon.svg',
        data: { url: payload.data?.url || '/' }
    };
    self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = event.notification.data?.url || '/';
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
        for (const client of windowClients) {
            if ('focus' in client) {
                client.navigate(target);
                return client.focus();
            }
        }
        return clients.openWindow(target);
    }));
});
