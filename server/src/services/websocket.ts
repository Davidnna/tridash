import { Server, Socket } from 'socket.io';
import prisma from '../utils/database';

let io: Server;

export function setupWebSocket(socketIO: Server) {
    io = socketIO;

    io.on('connection', (socket: Socket) => {
        console.log(`🔌 WebSocket client connected: ${socket.id}`);

        socket.on('disconnect', async () => {
            console.log(`🔌 WebSocket client disconnected: ${socket.id}`);

            // Clean up subscriptions for this connection
            await prisma.entitySubscription.deleteMany({
                where: { connectionId: socket.id },
            });
        });

        // Subscribe to entity updates
        socket.on('subscribe', async (data: { entityType: string; entityId: string }) => {
            const { entityType, entityId } = data;

            if (!['rides', 'drivers'].includes(entityType)) {
                socket.emit('error', { message: 'Invalid entity type' });
                return;
            }

            try {
                await prisma.entitySubscription.create({
                    data: {
                        entityType,
                        entityId,
                        connectionId: socket.id,
                    },
                });

                socket.emit('subscribed', { entityType, entityId });
            } catch (error) {
                console.error('Subscription error:', error);
                socket.emit('error', { message: 'Subscription failed' });
            }
        });

        // Unsubscribe from entity updates
        socket.on('unsubscribe', async (data: { entityType: string; entityId: string }) => {
            const { entityType, entityId } = data;

            try {
                await prisma.entitySubscription.deleteMany({
                    where: {
                        entityType,
                        entityId,
                        connectionId: socket.id,
                    },
                });

                socket.emit('unsubscribed', { entityType, entityId });
            } catch (error) {
                console.error('Unsubscription error:', error);
            }
        });
    });

    return io;
}

export async function notifySubscribers(
    entityType: string,
    entityId: string,
    data: any,
    excludeConnectionId?: string
) {
    if (!io) {
        console.warn('WebSocket not initialized');
        return;
    }

    try {
        const subscriptions = await prisma.entitySubscription.findMany({
            where: {
                entityType,
                entityId,
            },
        });

        const targetConnections = subscriptions
            .map(sub => sub.connectionId)
            .filter(id => id !== excludeConnectionId);

        if (targetConnections.length === 0) {
            return;
        }

        const uniqueConnections = Array.from(new Set(targetConnections));

        uniqueConnections.forEach(connectionId => {
            io.to(connectionId).emit('entity.update', {
                entityType,
                entityId,
                data,
            });
        });

        console.log(`📡 Notified ${uniqueConnections.length} subscribers for ${entityType}:${entityId}`);
    } catch (error) {
        console.error('Notify subscribers error:', error);
    }
}

export function getIO() {
    if (!io) {
        throw new Error('WebSocket not initialized. Call setupWebSocket first.');
    }
    return io;
}

export default { setupWebSocket, notifySubscribers, getIO };
