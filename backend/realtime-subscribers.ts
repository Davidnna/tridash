import { db, ws, json, error } from '@appdeploy/sdk';

const SUBSCRIPTIONS_TABLE = 'entity_subscriptions';

type Session = { tokenHash: string; userId: string; expiresAt: number };
type User = { id: string; role: 'passenger' | 'driver' | 'admin'; status?: string };

function getCookie(event: any, name: string) {
  const header = event?.headers?.cookie || event?.headers?.Cookie || '';
  const match = String(header).split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function digestHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getRealtimeUser(event: any) {
  const token = getCookie(event, 'tridash_session');
  if (!token) return null;
  const tokenHash = await digestHex(token);
  const sessions = await db.list<Session>('app_sessions', { limit: 100 });
  const session = sessions.items.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  if (!session) return null;
  const users = await db.list<User>('app_users', { limit: 100 });
  const user = users.items.find(item => item.id === session.userId);
  if (!user || user.status === 'suspended') return null;
  return user;
}

async function canSubscribe(user: User, entityType: string, entityId: string) {
  if (user.role === 'admin') return true;
  if (entityType === 'rides') {
    const [ride] = await db.get<any>('rides', [entityId]);
    return !!ride && (ride.passengerId === user.id || ride.driverId === user.id);
  }
  if (entityType === 'drivers') {
    const [driver] = await db.get<any>('drivers', [entityId]);
    return !!driver && driver.userId === user.id;
  }
  return false;
}

export type SubscriptionRecord = {
  id: string;
  entity_type: string;
  entity_id: string;
  connection_id: string;
  created_at: number;
};

async function listSubscriptions(): Promise<SubscriptionRecord[]> {
  const { items } = await db.list(SUBSCRIPTIONS_TABLE, { limit: 1000 });
  return items as SubscriptionRecord[];
}

export async function removeSubscriptionsByConnection(connectionId: string) {
  const items = await listSubscriptions();
  const matchIds = items
    .filter(item => item.connection_id === connectionId)
    .map(item => item.id);
  if (matchIds.length > 0) {
    await db.delete(SUBSCRIPTIONS_TABLE, matchIds);
  }
}

export async function addSubscription(
  entityType: string,
  entityId: string,
  connectionId: string
) {
  await db.add(SUBSCRIPTIONS_TABLE, [
    {
      entity_type: entityType,
      entity_id: entityId,
      connection_id: connectionId,
      created_at: Date.now(),
    },
  ]);
}

export async function removeSubscriptions(
  entityType: string,
  entityId: string,
  connectionId: string
) {
  const items = await listSubscriptions();
  const matchIds = items
    .filter(
      item =>
        item.entity_type === entityType &&
        item.entity_id === entityId &&
        item.connection_id === connectionId
    )
    .map(item => item.id);
  if (matchIds.length > 0) {
    await db.delete(SUBSCRIPTIONS_TABLE, matchIds);
  }
}

export async function notifySubscribers(
  entityType: string,
  entityId: string,
  payload: unknown,
  excludeConnectionId?: string
) {
  const items = await listSubscriptions();
  const targets = items
    .filter(
      item => item.entity_type === entityType && item.entity_id === entityId
    )
    .map(item => item.connection_id)
    .filter(id => id !== excludeConnectionId);
  const targetConnectionIds = Array.from(new Set(targets));

  if (targetConnectionIds.length === 0) {
    return;
  }

  await ws.send(targetConnectionIds, {
    v: 1,
    type: 'entity.update',
    payload: {
      entity_type: entityType,
      entity_id: entityId,
      data: payload,
    },
  });
}

export const realtimeSubscriptionRoutes = {
  'POST /api/subscriptions': [
    async ({ body, event }) => {
      const user = await getRealtimeUser(event);
      if (!user) return error('Authentication required', 401);
      const { entity_type, entity_id, connection_id } = (body || {}) as Record<
        string,
        string
      >;
      if (!entity_type || !entity_id || !connection_id) return error('entity_type, entity_id, connection_id are required', 400);
      if (!['rides', 'drivers'].includes(entity_type)) return error('Unsupported subscription entity', 400);
      if (String(connection_id).length > 200) return error('Invalid connection id', 400);
      if (!(await canSubscribe(user, entity_type, entity_id))) return error('Forbidden', 403);
      await addSubscription(entity_type, entity_id, connection_id);
      return json({ ok: true });
    },
  ],

  'POST /api/subscriptions/remove': [
    async ({ body, event }) => {
      const user = await getRealtimeUser(event);
      if (!user) return error('Authentication required', 401);
      const { entity_type, entity_id, connection_id } = (body || {}) as Record<
        string,
        string
      >;
      if (!entity_type || !entity_id || !connection_id) return error('entity_type, entity_id, connection_id are required', 400);
      if (!['rides', 'drivers'].includes(entity_type)) return error('Unsupported subscription entity', 400);
      if (String(connection_id).length > 200) return error('Invalid connection id', 400);
      if (!(await canSubscribe(user, entity_type, entity_id))) return error('Forbidden', 403);
      await removeSubscriptions(entity_type, entity_id, connection_id);
      return json({ ok: true });
    },
  ],
};
