// WebSocket Client - Replaces @appdeploy/client ws
// Provides real-time updates using Socket.io

import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type MessageHandler = (message: any) => void;
type ErrorHandler = (error: Error) => void;

export interface WebSocketConnection {
  readonly ready: Promise<void>;
  readonly connectionId: string | null;
  onMessage(handler: MessageHandler): () => void;
  onError(handler: ErrorHandler): () => void;
  disconnect(): void;
}

class WebSocketClient {
  private socket: Socket | null = null;
  private connection: WebSocketConnection | null = null;
  private subscriptions: Map<string, Set<Function>> = new Map();

  connect(): WebSocketConnection {
    if (this.connection && this.socket) {
      return this.connection;
    }

    const socket = io(WS_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    this.socket = socket;

    const ready = new Promise<void>(resolve => {
      if (socket.connected) {
        resolve();
        return;
      }
      socket.once('connect', () => resolve());
    });

    const connection: WebSocketConnection = {
      get ready() {
        return ready;
      },
      get connectionId() {
        return socket.id || null;
      },
      onMessage: handler => {
        const listener = (data: any) => {
          handler({
            type: 'entity.update',
            entity_type: data?.entityType,
            entity_id: data?.entityId,
            payload: { data: data?.data },
            data: data?.data,
          });
        };
        socket.on('entity.update', listener);
        return () => socket.off('entity.update', listener);
      },
      onError: handler => {
        const listener = (error: Error) => handler(error);
        socket.on('connect_error', listener);
        socket.on('error', listener);
        return () => {
          socket.off('connect_error', listener);
          socket.off('error', listener);
        };
      },
      disconnect: () => this.disconnect(),
    };

    this.connection = connection;

    socket.on('connect', () => {
      console.log('🔌 WebSocket connected');
    });

    socket.on('disconnect', () => {
      console.log('🔌 WebSocket disconnected');
    });

    socket.on('entity.update', (data: any) => {
      const { entityType, entityId, data: updateData } = data;
      const key = `${entityType}:${entityId}`;
      const callbacks = this.subscriptions.get(key);

      callbacks?.forEach(callback => {
        try {
          callback(updateData);
        } catch (error) {
          console.error('WebSocket callback error:', error);
        }
      });
    });

    return connection;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connection = null;
    this.subscriptions.clear();
  }

  subscribe(entityType: string, entityId: string, callback?: Function) {
    if (!this.socket) {
      this.connect();
    }

    const key = `${entityType}:${entityId}`;
    if (callback) {
      if (!this.subscriptions.has(key)) {
        this.subscriptions.set(key, new Set());
      }
      this.subscriptions.get(key)!.add(callback);
    }

    this.socket?.emit('subscribe', { entityType, entityId });

    return () => {
      if (callback) this.unsubscribe(entityType, entityId, callback);
      else this.unsubscribe(entityType, entityId);
    };
  }

  unsubscribe(entityType: string, entityId: string, callback?: Function) {
    const key = `${entityType}:${entityId}`;
    const callbacks = this.subscriptions.get(key);

    if (callback && callbacks) {
      callbacks.delete(callback);
      if (callbacks.size > 0) return;
    }

    this.subscriptions.delete(key);
    this.socket?.emit('unsubscribe', { entityType, entityId });
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getConnectionId(): string | null {
    return this.socket?.id || null;
  }
}

export const ws = new WebSocketClient();
export default WebSocketClient;
