// Notifications API - Replaces @appdeploy/client notifications
// Note: This is a browser-permission stub. For full push notifications, choose a provider,
// register device tokens with the backend, and deliver notifications through that provider.

class NotificationsClient {
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  }

  async showNotification(title: string, options?: NotificationOptions) {
    const hasPermission = await this.requestPermission();

    if (hasPermission) {
      new Notification(title, options);
    } else {
      console.warn('Notification permission not granted');
    }
  }

  // Placeholder for future FCM integration
  async getToken(): Promise<string | null> {
    console.warn('FCM token generation not implemented yet');
    return null;
  }

  // Placeholder for subscribing to topics
  async subscribe(_topic?: string): Promise<void> {
    console.warn('Topic subscription not implemented yet');
  }
}

// Export singleton instance
export const notifications = new NotificationsClient();

// Export class
export default NotificationsClient;
