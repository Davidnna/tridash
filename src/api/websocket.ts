// WebSocket Client - Replaces @appdeploy/client ws
// Provides real-time updates using Socket.io

import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class WebSocketClient {
  private socket: Socket | null = null;
  private subscriptions: Map<string, Set<Function>> = new Map();

  connect() {
    if (this.socket?.connected) {
      return this.socket;
    }

    this.socket = io(WS_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log('🔌 WebSocket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('🔌 WebSocket disconnected');
    });

    this.socket.on('entity.update', (data: any) => {
      const { entityType, entityId, data: updateData } = data;
      const key = `${entityType}:${entityId}`;
      const callbacks = this.subscriptions.get(key);

      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(updateData);
          } catch (error) {
            console.error('WebSocket callback error:', error);
          }
        });
      }
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.subscriptions.clear();
  }

  subscribe(entityType: string, entityId: string, callback: Function) {
    if (!this.socket || !this.socket.connected) {
      this.connect();
    }

    const key = `${entityType}:${entityId}`;

    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set());
    }

    this.subscriptions.get(key)!.add(callback);

    // Send subscribe message to server
    this.socket?.emit('subscribe', { entityType, entityId });

    // Return unsubscribe function
    return () => {
      this.unsubscribe(entityType, entityId, callback);
    };
  }

  unsubscribe(entityType: string, entityId: string, callback?: Function) {
    const key = `${entityType}:${entityId}`;
    const callbacks = this.subscriptions.get(key);

    if (callback && callbacks) {
      callbacks.delete(callback);

      if (callbacks.size === 0) {
        this.subscriptions.delete(key);
        this.socket?.emit('unsubscribe', { entityType, entityId });
      }
    } else {
      this.subscriptions.delete(key);
      this.socket?.emit('unsubscribe', { entityType, entityId });
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getConnectionId(): string | null {
    return this.socket?.id || null;
  }
}

// Export singleton instance
export const ws = new WebSocketClient();

// Export class for custom instances
export default WebSocketClient;
