import { db, notifications, router, json, error, secrets } from '@appdeploy/sdk';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { notifySubscribers, realtimeSubscriptionRoutes } from './realtime-subscribers';

type AppUser = {
  id: string;
  firebaseUid: string;
  email: string;
  name: string;
  role: 'passenger' | 'driver' | 'admin';
  emailVerified: boolean;
  isSuperAdmin?: boolean;
  createdAt: string;
  updatedAt?: string;
};

type AppSession = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
};

const SUPER_ADMIN_EMAIL = 'davedozie1@gmail.com';

const seedRides = [
  { id: 'ride-101', passenger: 'Kelechi', pickup: 'Presidential Road', destination: 'Akanu Ibiam Airport', status: 'Accepted', amount: 2500, driver: 'Chinedu', tricycle: 'EB-214-KP', paymentStatus: 'Pending' },
  { id: 'ride-102', passenger: 'Amaka', pickup: 'Abakpa Junction', destination: 'CAS Campus', status: 'Requested', amount: 1800, driver: null, paymentStatus: 'Pending' },
  { id: 'ride-103', passenger: 'David', pickup: 'Waterworks', destination: 'Main Market', status: 'Completed', amount: 1500, driver: 'Emeka', tricycle: 'EB-991-XQ', rating: 5, paymentStatus: 'Paid' }
];

const seedDrivers = [
  { name: 'Chinedu Okafor', phone: '0803 555 0142', rating: 4.9, verified: true, online: true, tricycle: 'EB-214-KP', documents: ['Government ID', 'Tricycle registration'], status: 'active' },
  { name: 'Emeka Nwosu', phone: '0814 201 8820', rating: 4.7, verified: true, online: false, tricycle: 'EB-991-XQ', documents: ['Government ID', 'Tricycle registration'], status: 'active' },
  { name: 'Ifeanyi Eze', phone: '0706 441 9021', rating: 0, verified: false, online: false, tricycle: 'EB-403-ZR', documents: ['Government ID', 'Tricycle registration'], status: 'pending' }
];

let firebaseAuthPromise: Promise<ReturnType<typeof getAuth>> | null = null;

async function getFirebaseAuth() {
  if (!firebaseAuthPromise) {
    firebaseAuthPromise = (async () => {
      const raw = await secrets.readSecret('FIREBASE_SERVICE_ACCOUNT_JSON');
      const serviceAccount = JSON.parse(raw);
      const app = getApps().length
        ? getApps()[0]
        : initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
      return getAuth(app);
    })();
  }
  return firebaseAuthPromise;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function digestHex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function makeSessionToken() {
  return crypto.randomUUID() + '.' + crypto.randomUUID();
}

function getCookie(event: any, name: string) {
  const header = event?.headers?.cookie || event?.headers?.Cookie || '';
  const match = String(header).split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function cookieResponse(data: unknown, status: number, cookie: string) {
  const response = json(data, status);
  return { ...response, headers: { ...response.headers, 'Set-Cookie': cookie } };
}

async function findUserByFirebaseUid(firebaseUid: string) {
  const result = await db.list<AppUser>('app_users', { limit: 100 });
  return result.items.find(user => user.firebaseUid === firebaseUid) || null;
}

async function findUserByEmail(email: string) {
  const result = await db.list<AppUser>('app_users', { limit: 100 });
  return result.items.find(user => user.email.toLowerCase() === email.toLowerCase()) || null;
}

async function findUserById(userId: string) {
  const result = await db.list<AppUser>('app_users', { limit: 100 });
  return result.items.find(user => user.id === userId) || null;
}

async function createSession(userId: string) {
  const token = makeSessionToken();
  const tokenHash = await digestHex(token);
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const [id] = await db.add('app_sessions', [{ tokenHash, userId, expiresAt }]);
  if (!id) throw new Error('Unable to create session');
  return { token, expiresAt };
}

async function getCurrentUser(event: any) {
  const token = getCookie(event, 'tridash_session');
  if (!token) return null;
  const tokenHash = await digestHex(token);
  const result = await db.list<AppSession>('app_sessions', { limit: 100 });
  const session = result.items.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  if (!session) return null;
  return findUserById(session.userId);
}

function requireAppUser() {
  return async (ctx: any) => {
    const user = await getCurrentUser(ctx.event);
    if (!user?.firebaseUid) return error('Firebase authentication required', 401);
    if (!user.emailVerified) return error('Please verify your email address before using Tridash', 403);
    if ((user as any).status === 'suspended') return error('Your Tridash account is suspended. Contact an administrator for assistance.', 403);
    ctx.user = { userId: user.id, email: user.email, name: user.name, scope: 'app_user' };
    return undefined;
  };
}

async function getProfileByUserId(userId: string) {
  const result = await db.list<any>('profiles', { limit: 100 });
  return result.items.find(profile => profile.userId === userId) || null;
}

async function getCurrentUserFromContext(userId: string) {
  return findUserById(userId);
}

async function listOrSeed<T>(table: string, seed: T[]) {
  const result = await db.list<T>(table, { limit: 50 });
  if (result.items.length) return result.items;
  await db.add(table, seed as Array<Record<string, unknown>>);
  return (await db.list<T>(table, { limit: 50 })).items;
}

async function notifyUser(userId: string | undefined, title: string, body: string, url = '/') {
  if (!userId) return;
  const record = { userId, title: title.slice(0, 160), body: body.slice(0, 1000), url: url || '/', read: false, createdAt: new Date().toISOString() };
  try { await db.add('notifications', [record]); } catch (e) { console.warn('notification history write failed', e); }
  try {
    await notifications.send({ userIds: [userId], notification: { title, body, url }, data: { source: 'tridash' }, ttlSeconds: 900 });
  } catch (e) {
    console.warn('notification delivery failed', e);
  }
}

function requestOrigin(event: any) {
  const forwarded = event?.headers?.['x-forwarded-proto'] || event?.headers?.['X-Forwarded-Proto'] || 'https';
  const host = event?.headers?.host || event?.headers?.Host;
  return host ? String(forwarded).split(',')[0] + '://' + host : 'https://tridash-7cay0x.v2.appdeploy.ai';
}

async function paystackRequest(path: string, options: RequestInit = {}) {
  const secret = await secrets.readSecret('PAYSTACK_SECRET_KEY');
  const response = await fetch('https://api.paystack.co' + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + secret,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok || !data?.status) throw new Error(data?.message || 'Paystack request failed');
  return data;
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success', app: 'Tridash' })],

  'POST /api/auth/firebase-session': [async ({ body }) => {
    const input = body as Record<string, unknown>;
    const idToken = String(input.idToken || '');
    const requestedRole = input.role === 'driver' ? 'driver' : 'passenger';
    if (!idToken) return error('Firebase ID token is required', 400);

    try {
      const firebaseAuth = await getFirebaseAuth();
      const decoded = await firebaseAuth.verifyIdToken(idToken);
      const email = String(decoded.email || '').trim().toLowerCase();
      if (!decoded.uid || !email) return error('Firebase account must have an email address', 400);
      if (!decoded.email_verified) return error('Please verify your email address before using Tridash', 403);

      let user = await findUserByFirebaseUid(decoded.uid);
      const now = new Date().toISOString();

      if (!user) {
        const existingByEmail = await findUserByEmail(email);
        if (existingByEmail?.firebaseUid && existingByEmail.firebaseUid !== decoded.uid) {
          return error('This email is already linked to another Tridash identity', 409);
        }

        const isSuperAdmin = email === SUPER_ADMIN_EMAIL;
        const role = isSuperAdmin ? 'admin' : requestedRole;
        const userRecord = {
          firebaseUid: decoded.uid,
          email,
          name: String(decoded.name || email.split('@')[0]),
          role,
          emailVerified: true,
          isSuperAdmin,
          createdAt: now,
          updatedAt: now
        };

        if (existingByEmail) {
          const [ok] = await db.update('app_users', [{ id: existingByEmail.id, record: userRecord }]);
          if (!ok) return error('Unable to link your Tridash account', 500);
          user = { ...existingByEmail, ...userRecord };
        } else {
          const [dbId] = await db.add('app_users', [userRecord]);
          if (!dbId) return error('Unable to create your Tridash profile', 500);
          user = { ...userRecord, id: dbId };
          await db.add('profiles', [{ userId: dbId, name: userRecord.name, phone: '', emergencyName: '', emergencyPhone: '', role }]);
        }
      } else {
        if ((user as any).status === 'suspended') return error('This Tridash account is suspended. Contact an administrator for assistance.', 403);
        const updates = {
          email,
          name: String(decoded.name || user.name || email.split('@')[0]),
          emailVerified: true,
          updatedAt: now
        };
        const [ok] = await db.update('app_users', [{ id: user.id, record: { ...user, ...updates } }]);
        if (!ok) return error('Unable to update your Tridash profile', 500);
        user = { ...user, ...updates };
      }

      // A driver must explicitly choose to go online after each login.
      if (user.role === 'driver') {
        const driverRows = await db.list<any>('drivers', { limit: 200 });
        const driver = driverRows.items.find((item: any) => item.userId === user.id);
        if (driver) {
          const record: any = { ...driver, online: false };
          delete record.lastLocation;
          await db.update('drivers', [{ id: driver.id, record }]);
          await notifySubscribers('drivers', driver.id, { id: driver.id, online: false, lastLocation: null });
        }
      }
      const session = await createSession(user.id);
      return cookieResponse(
        { user: { userId: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified, isSuperAdmin: !!user.isSuperAdmin } },
        200,
        `tridash_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
      );
    } catch (e) {
      console.warn('Firebase session verification failed', e);
      return error('Unable to verify your Firebase session', 401);
    }
  }],

  'GET /api/auth/me': [async ({ event }) => {
    const user = await getCurrentUser(event);
    if (!user?.firebaseUid) return error('Authentication required', 401);
    const profile = await getProfileByUserId(user.id);
    return json({
      user: { userId: user.id, email: user.email, name: user.name, role: user.role, emailVerified: user.emailVerified, isSuperAdmin: !!user.isSuperAdmin },
      profile: profile || { userId: user.id, name: user.name, phone: '', emergencyName: '', emergencyPhone: '', role: user.role }
    });
  }],

  'POST /api/auth/logout': [async ({ event }) => {
    const token = getCookie(event, 'tridash_session');
    if (token) {
      const tokenHash = await digestHex(token);
      const sessions = await db.list<AppSession>('app_sessions', { limit: 100 });
      const session = sessions.items.find(item => item.tokenHash === tokenHash);
      if (session) {
        const user = await findUserById(session.userId);
        if (user?.role === 'driver') {
          const driverRows = await db.list<any>('drivers', { limit: 200 });
          const driver = driverRows.items.find((item: any) => item.userId === user.id);
          if (driver) {
            const record: any = { ...driver, online: false };
            delete record.lastLocation;
            await db.update('drivers', [{ id: driver.id, record }]);
            await notifySubscribers('drivers', driver.id, { id: driver.id, online: false, lastLocation: null });
          }
        }
        await db.delete('app_sessions', [session.id]);
      }
    }
    return cookieResponse({ ok: true }, 200, 'tridash_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  }],

  'GET /api/rides': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    const result = await db.list<any>('rides', { limit: 50 });
    const rides = result.items.length ? result.items : await listOrSeed('rides', seedRides);
    if (current?.role === 'admin') return json({ rides });
    if (current?.role === 'driver') return json({ rides: rides.filter(ride => ride.status === 'Requested' || ride.driverId === current.id) });
    return json({ rides: rides.filter(ride => ride.passengerId === current?.id) });
  }],

  'POST /api/rides': [requireAppUser(), async ({ body, user }) => {
    const input = body as Record<string, unknown>;
    const pickup = String(input.pickup || '').trim();
    const destination = String(input.destination || '').trim();
    const amount = Number(input.amount);
    const profile = await getProfileByUserId(user!.userId);
    const riderPhone = String(input.riderPhone || input.passengerPhone || profile?.phone || '').trim();
    const riderName = String(input.riderName || input.passenger || profile?.name || 'Passenger').trim();
    if (riderPhone.length < 7) return error('Passenger phone number is required before booking', 400);
    if (riderName.length < 2) return error('Passenger name is required before booking', 400);
    if (pickup.length < 2 || destination.length < 2) return error('Pickup and destination are required', 400);
    if (!Number.isInteger(amount) || amount < 800 || amount > 100000) return error('Ride fare is invalid', 400);
    const ride = {
      passengerId: user!.userId,
      passenger: riderName.slice(0, 120),
      passengerPhone: riderPhone.slice(0, 40),
      riderName: riderName.slice(0, 120),
      riderPhone: riderPhone.slice(0, 40),
      bookedForSelf: input.bookedForSelf !== false,
      driverId: null,
      driver: null,
      pickup: pickup.slice(0, 300),
      destination: destination.slice(0, 300),
      pickupCoords: input.pickupCoords,
      destinationCoords: input.destinationCoords,
      status: 'Requested',
      amount,
      paymentStatus: 'Pending',
      paymentMethod: 'Paystack',
      requestedAt: new Date().toISOString()
    };
    const [id] = await db.add('rides', [ride]);
    if (!id) return error('Unable to create ride', 500);
    const record = { ...ride, id };
    await notifySubscribers('rides', id, record);
    return json({ ride: record }, 201);
  }],

  'POST /api/rides/:id/reject': [requireAppUser(), async ({ params, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'driver') return error('Driver access required', 403);
    const [ride] = await db.get<any>('rides', [params.id]);
    if (!ride || ride.status !== 'Requested') return error('Ride is no longer available', 409);
    const driverRecord = (await db.list<any>('drivers', { limit: 100 })).items.find((item: any) => item.userId === current.id);
    if (!driverRecord || !driverRecord.verified || driverRecord.status === 'suspended' || !driverRecord.online) return error('You must be a verified online driver to reject rides', 403);
    const record = { ...ride, rejectedByDriverIds: Array.from(new Set([...(ride.rejectedByDriverIds || []), current.id])), lastRejectedAt: new Date().toISOString() };
    const [ok] = await db.update('rides', [{ id: params.id, record }]);
    if (!ok) return error('Unable to record ride rejection', 500);
    await notifySubscribers('rides', params.id, { ...record, id: params.id });
    return json({ ride: { ...record, id: params.id } });
  }],

  'POST /api/rides/:id/accept': [requireAppUser(), async ({ params, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'driver') return error('Driver access required', 403);
    const [driver] = await db.get<any>('drivers', [String((await db.list<any>('drivers', { limit: 100 })).items.find((item: any) => item.userId === current.id)?.id || '')]);
    if (!driver || driver.userId !== current.id) return error('Driver profile not found', 404);
    if (!driver.verified || driver.status === 'suspended' || !driver.online) return error('You must be a verified online driver to accept rides', 403);
    if (String(driver.phone || '').trim().length < 7) return error('Add your phone number to your driver profile before accepting rides', 400);
    const [storedRide] = await db.get<any>('rides', [params.id]);
    const existing = storedRide || (await db.list<any>('rides', { limit: 100 })).items.find((item: any) => String(item.id) === String(params.id));
    if (!existing || existing.status !== 'Requested') return error(existing?.status === 'Cancelled' ? 'Passenger cancelled this ride' : existing?.driverId ? 'Ride has already been accepted by another driver' : 'Ride is no longer available', 409);
    const passengerProfile = existing.passengerId ? await getProfileByUserId(existing.passengerId) : null;
    const record = { ...existing, driverId: current.id, driver: driver.name, driverPhone: driver.phone, tricycle: driver.tricycle, passengerPhone: existing.riderPhone || existing.passengerPhone || passengerProfile?.phone || '', status: 'Accepted', acceptedAt: new Date().toISOString() };
    const [ok] = await db.update('rides', [{ id: params.id, record }]);
    if (!ok) return error('Unable to accept ride', 500);
    await notifySubscribers('rides', params.id, { ...record, id: params.id });
    await notifyUser(record.passengerId, 'Driver assigned', driver.name + ' accepted your Tridash ride.', '/');
    return json({ ride: { ...record, id: params.id } });
  }],

  'PUT /api/rides/:id': [requireAppUser(), async ({ params, body, user }) => {
    const [existing] = await db.get<any>('rides', [params.id]);
    if (!existing) return error('Ride not found', 404);
    if (existing.passengerId && existing.passengerId !== user!.userId && existing.driverId !== user!.userId && (await getCurrentUserFromContext(user!.userId))?.role !== 'admin') return error('Forbidden', 403);
    const input = body as Record<string, unknown>;
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current) return error('Authentication required', 401);
    if (current.role !== 'admin') {
      if (current.role !== 'driver' || existing.driverId !== current.id) return error('Forbidden', 403);
      const requestedStatus = String(input.status || existing.status);
      const allowed = (existing.status === 'Accepted' && requestedStatus === 'In Progress') || (existing.status === 'In Progress' && requestedStatus === 'Completed');
      if (!allowed) return error('Invalid ride status transition', 409);
    }
    const safeFields = current.role === 'admin' ? input : { status: input.status };
    const record = { ...existing, ...safeFields };
    const [ok] = await db.update('rides', [{ id: params.id, record }]);
    if (!ok) return error('Unable to update ride', 500);
    await notifySubscribers('rides', params.id, record);
    if (record.passengerId && record.status) await notifyUser(record.passengerId, 'Ride update', 'Your Tridash ride is now ' + record.status + '.', '/');
    return json({ ride: { ...record, id: params.id } });
  }],

  'POST /api/rides/:id/cancel': [requireAppUser(), async ({ params, user }) => {
    const [storedRide] = await db.get<any>('rides', [params.id]);
    const existing = storedRide || (await db.list<any>('rides', { limit: 100 })).items.find((item: any) => String(item.id) === String(params.id));
    if (!existing || String(existing.passengerId) !== String(user!.userId)) return error('Ride not found', 404);
    if (['Completed','Cancelled'].includes(existing.status)) return error('This ride can no longer be cancelled', 409);
    const record = { ...existing, status: 'Cancelled', cancelledAt: new Date().toISOString() };
    const [ok] = await db.update('rides', [{ id: params.id, record }]);
    if (!ok) return error('Unable to cancel ride', 500);
    await notifySubscribers('rides', params.id, record);
    return json({ ride: { ...record, id: params.id } });
  }],

  'GET /api/drivers': [requireAppUser(), async () => json({ drivers: await listOrSeed('drivers', seedDrivers) })],

  'GET /api/mapbox-token': [async () => { try { const token = await secrets.readSecret('MAPBOX_PUBLIC_TOKEN'); return json({ token }); } catch { return error('Map service is not configured',503); } }],
  'GET /api/mapbox/geocode': [requireAppUser(), async ({ query }) => { const q = String(query?.q || '').trim(); if (!q) return error('A destination search is required',400); try { const token = await secrets.readSecret('MAPBOX_PUBLIC_TOKEN'); const url = 'https://api.mapbox.com/search/geocode/v6/forward?q=' + encodeURIComponent(q) + '&country=ng&limit=1&autocomplete=true&access_token=' + encodeURIComponent(token); const response = await fetch(url); if (!response.ok) return error('Location search is temporarily unavailable',502); const data = await response.json(); const feature = data?.features?.[0]; if (!feature) return error('Destination not found',404); return json({ feature }); } catch { return error('Location search is temporarily unavailable',502); } }],
  'GET /api/mapbox/reverse': [async ({ query }) => { const lng=Number(query?.lng); const lat=Number(query?.lat); if(!Number.isFinite(lng)||!Number.isFinite(lat)) return error('Valid coordinates are required',400); try { const token=await secrets.readSecret('MAPBOX_PUBLIC_TOKEN'); const url='https://api.mapbox.com/search/geocode/v6/reverse?longitude='+lng+'&latitude='+lat+'&country=ng&limit=1&access_token='+encodeURIComponent(token); const response=await fetch(url); if(!response.ok)return error('Address lookup is temporarily unavailable',502); const data=await response.json(); const feature=data?.features?.[0]; return json({ placeName: feature?.properties?.full_address || feature?.properties?.name || feature?.place_name || null }); } catch { return error('Address lookup is temporarily unavailable',502); } }],
  'GET /api/route': [requireAppUser(), async ({ query }) => { const values=[Number(query?.fromLat),Number(query?.fromLng),Number(query?.toLat),Number(query?.toLng)]; if(!values.every(Number.isFinite)) return error('Valid route coordinates are required',400); const [fromLat,fromLng,toLat,toLng]=values; try { const token=await secrets.readSecret('MAPBOX_PUBLIC_TOKEN'); const coordinates=fromLng+','+fromLat+';'+toLng+','+toLat; const url='https://api.mapbox.com/directions/v5/mapbox/driving/'+coordinates+'?overview=full&geometries=geojson&steps=false&access_token='+encodeURIComponent(token); const response=await fetch(url); if(!response.ok)return error('Routing service is temporarily unavailable',502); const data=await response.json(); const route=data?.routes?.[0]; if(!route)return error('No drivable route found',404); return json({route:{distanceMeters:route.distance,durationSeconds:route.duration,geometry:route.geometry}}); } catch { return error('Routing service is temporarily unavailable',502); } }], 'POST /api/driver/location': [requireAppUser(), async ({ body, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'driver') return error('Driver access required', 403);
    const input = body as Record<string, unknown>;
    const lat = Number(input.lat), lng = Number(input.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return error('Valid location required', 400);
    const drivers = await listOrSeed<any>('drivers', seedDrivers);
    const driver = drivers.find((d:any) => d.userId === current.id);
    if (!driver) return error('Driver profile not found', 404);
    const rides = await db.list<any>('rides', { limit: 100 });
    const activeRide = rides.items.find((ride: any) => ride.driverId === current.id && ride.id === String(input.rideId || '') && ['Accepted', 'In Progress'].includes(ride.status));
    if (!activeRide) return error('Location updates are only allowed for your active ride', 409);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return error('Location coordinates are out of range', 400);
    const record = { ...driver, lastLocation: { lat, lng, updatedAt: new Date().toISOString() } };
    await db.update('drivers', [{ id: driver.id, record }]);
    await notifySubscribers('drivers', driver.id, { id: driver.id, lastLocation: record.lastLocation });
    return json({ location: record.lastLocation });
  }],

  'GET /api/driver/me': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'driver') return error('Driver access required', 403);
    const drivers = await listOrSeed<any>('drivers', seedDrivers);
    let driver = drivers.find((item: any) => item.userId === current.id) || null;
    if (!driver) {
      const profile = await getProfileByUserId(current.id);
      const record = { name: profile?.name || current.name, userId: current.id, phone: profile?.phone || '', rating: 0, verified: false, online: false, tricycle: '', documents: [], status: 'pending' };
      const [id] = await db.add('drivers', [record]);
      if (!id) return error('Unable to create driver profile', 500);
      driver = { ...record, id };
    }
    return json({ driver });
  }],

  'PUT /api/driver/me': [requireAppUser(), async ({ body, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'driver') return error('Driver access required', 403);
    const drivers = await listOrSeed<any>('drivers', seedDrivers);
    const existing = drivers.find((item: any) => item.userId === current.id);
    if (!existing) return error('Driver profile not found', 404);
    const incoming = body as Record<string, unknown>;
    const record = { ...existing, name: typeof incoming.name === 'string' ? incoming.name.trim().slice(0, 120) : existing.name, phone: typeof incoming.phone === 'string' ? incoming.phone.trim().slice(0, 40) : existing.phone, tricycle: typeof incoming.tricycle === 'string' ? incoming.tricycle.trim().slice(0, 40) : existing.tricycle, documents: Array.isArray(incoming.documents) ? incoming.documents.filter((item): item is string => typeof item === 'string').slice(0, 10).map(item => item.slice(0, 120)) : existing.documents, online: typeof incoming.online === 'boolean' ? incoming.online : existing.online, userId: current.id, verified: existing.verified, status: existing.status };
    if (record.online === false) delete (record as Record<string, unknown>).lastLocation;
    const [ok] = await db.update('drivers', [{ id: existing.id, record }]);
    if (!ok) return error('Unable to update driver profile', 500);
    await notifySubscribers('drivers', existing.id, { id: existing.id, lastLocation: incoming.online === false ? null : undefined });
    return json({ driver: { ...record, id: existing.id } });
  }],

  'PUT /api/drivers/:id': [requireAppUser(), async ({ params, body, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || !['driver', 'admin'].includes(current.role)) return error('Forbidden', 403);
    const [existing] = await db.get<any>('drivers', [params.id]);
    if (!existing) return error('Driver not found', 404);
    if (current.role === 'driver' && existing.userId !== current.id) return error('Forbidden', 403);
    const input = body as Record<string, unknown>;
    if (current.role === 'driver' && ('verified' in input || 'status' in input || 'userId' in input || 'role' in input)) return error('Drivers cannot change verification or account status', 403);
    const record = current.role === 'admin'
      ? {
          ...existing,
          ...(typeof input.name === 'string' ? { name: input.name.trim().slice(0, 120) } : {}),
          ...(typeof input.phone === 'string' ? { phone: input.phone.trim().slice(0, 40) } : {}),
          ...(typeof input.tricycle === 'string' ? { tricycle: input.tricycle.trim().slice(0, 40) } : {}),
          ...(Array.isArray(input.documents) ? { documents: input.documents.filter((item): item is string => typeof item === 'string').slice(0, 10).map(item => item.slice(0, 120)) } : {}),
          ...(typeof input.online === 'boolean' ? { online: input.online } : {}),
          ...(typeof input.verified === 'boolean' ? { verified: input.verified } : {}),
          ...(['active', 'suspended', 'pending'].includes(String(input.status)) ? { status: String(input.status) } : {})
        }
      : { ...existing, online: input.online === true };
    const [ok] = await db.update('drivers', [{ id: params.id, record }]);
    if (!ok) return error('Unable to update driver', 500);
    await notifySubscribers('drivers', params.id, record);
    return json({ driver: { ...record, id: params.id } });
  }],

  'GET /api/notifications': [requireAppUser(), async ({ user }) => {
    const result = await db.list<any>('notifications', { limit: 100 });
    const items = result.items.filter((item: any) => item.userId === user!.userId).sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 50);
    return json({ notifications: items });
  }],

  'POST /api/notifications/:id/read': [requireAppUser(), async ({ params, user }) => {
    const [existing] = await db.get<any>('notifications', [params.id]);
    if (!existing || existing.userId !== user!.userId) return error('Notification not found', 404);
    if (existing.read) return json({ notification: existing });
    const [ok] = await db.update('notifications', [{ id: params.id, record: { ...existing, read: true, readAt: new Date().toISOString() } }]);
    if (!ok) return error('Unable to update notification', 500);
    return json({ notification: { ...existing, read: true, readAt: new Date().toISOString() } });
  }],

  'POST /api/notifications/read-all': [requireAppUser(), async ({ user }) => {
    const result = await db.list<any>('notifications', { limit: 100 });
    const unread = result.items.filter((item: any) => item.userId === user!.userId && !item.read);
    const readAt = new Date().toISOString();
    if (unread.length) await db.update('notifications', unread.map((item: any) => ({ id: item.id, record: { ...item, read: true, readAt } })));
    return json({ updated: unread.length });
  }],

  'GET /api/profile': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    const profile = await getProfileByUserId(user!.userId);
    return json({ profile: profile || { userId: user!.userId, name: current?.name || 'Passenger', phone: '', emergencyName: '', emergencyPhone: '', role: current?.role || 'passenger' } });
  }],

  'POST /api/profile': [requireAppUser(), async ({ body, user }) => {
    const existing = await getProfileByUserId(user!.userId);
    const current = await getCurrentUserFromContext(user!.userId);
    const input = body as Record<string, unknown>;
    const record = { ...(existing || {}), name: typeof input.name === 'string' ? input.name.trim().slice(0, 120) : (existing?.name || current?.name || 'Passenger'), phone: typeof input.phone === 'string' ? input.phone.trim().slice(0, 40) : (existing?.phone || ''), emergencyName: typeof input.emergencyName === 'string' ? input.emergencyName.trim().slice(0, 120) : (existing?.emergencyName || ''), emergencyPhone: typeof input.emergencyPhone === 'string' ? input.emergencyPhone.trim().slice(0, 40) : (existing?.emergencyPhone || ''), userId: user!.userId, role: current?.role || 'passenger' };
    if (existing) {
      const [ok] = await db.update('profiles', [{ id: existing.id, record }]);
      if (!ok) return error('Unable to update profile', 500);
      return json({ profile: { ...record, id: existing.id } });
    }
    const [id] = await db.add('profiles', [record]);
    return json({ profile: { ...record, id } }, 201);
  }],

  'GET /api/admin/users': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'admin') return error('Admin access required', 403);
    const result = await db.list<AppUser>('app_users', { limit: 200 });
    return json({ users: result.items.map(u => ({ id:u.id, name:u.name, email:u.email, role:u.role, emailVerified:u.emailVerified, isSuperAdmin:!!u.isSuperAdmin, status:(u as any).status||'active', createdAt:u.createdAt })) });
  }],

  'PUT /api/admin/users/:id': [requireAppUser(), async ({ params, body, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current || current.role !== 'admin') return error('Admin access required', 403);
    const [target] = await db.get<any>('app_users', [params.id]);
    if (!target) return error('User not found', 404);
    if (target.isSuperAdmin && !current.isSuperAdmin) return error('Superadmin account is protected', 403);
    const input = body as Record<string, unknown>;
    const requestedRole = String(input.role || target.role);
    if (!['passenger','driver','admin'].includes(requestedRole)) return error('Invalid account role', 400);
    const nextRole = requestedRole;
    if (target.isSuperAdmin && nextRole !== 'admin') return error('Superadmin role cannot be changed', 403);
    if (!current.isSuperAdmin && nextRole === 'admin' && target.role !== 'admin') return error('Only the superadmin can grant administrator access', 403);
    const record = { ...target, role: nextRole, status: input.status === 'suspended' ? 'suspended' : input.status === 'active' ? 'active' : ((target as any).status||'active'), updatedAt: new Date().toISOString() };
    const [ok] = await db.update('app_users', [{ id: target.id, record }]);
    if (!ok) return error('Unable to update user', 500);
    if (nextRole === 'driver') {
      const drivers = await listOrSeed<any>('drivers', seedDrivers);
      if (!drivers.some((d:any)=>d.userId===target.id)) await db.add('drivers',[{userId:target.id,name:target.name,phone:'',rating:0,verified:false,online:false,tricycle:'',documents:[],status:'pending'}]);
    }
    return json({ user: { id:record.id, name:record.name, email:record.email, role:record.role, status:record.status, isSuperAdmin:!!record.isSuperAdmin } });
  }],

  'POST /api/admin/reset-users': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current?.isSuperAdmin || current.email.toLowerCase() !== SUPER_ADMIN_EMAIL) return error('Superadmin access required', 403);
    const appUsers = (await db.list<any>('app_users', { limit: 200 })).items;
    const removeAppUsers = appUsers.filter((item:any) => !item.isSuperAdmin && String(item.email || '').toLowerCase() !== SUPER_ADMIN_EMAIL);
    const removeUserIds = new Set(removeAppUsers.map((item:any) => item.id));
    const profiles = (await db.list<any>('profiles', { limit: 200 })).items;
    const drivers = (await db.list<any>('drivers', { limit: 200 })).items;
    const sessions = (await db.list<any>('app_sessions', { limit: 200 })).items;
    const profileIds = profiles.filter((item:any) => removeUserIds.has(item.userId)).map((item:any) => item.id);
    const driverIds = drivers.filter((item:any) => removeUserIds.has(item.userId)).map((item:any) => item.id);
    const sessionIds = sessions.filter((item:any) => removeUserIds.has(item.userId)).map((item:any) => item.id);
    if (removeAppUsers.length) await db.delete('app_users', removeAppUsers.map((item:any) => item.id));
    if (profileIds.length) await db.delete('profiles', profileIds);
    if (driverIds.length) await db.delete('drivers', driverIds);
    if (sessionIds.length) await db.delete('app_sessions', sessionIds);
    const firebase = await getFirebaseAuth();
    const removeFirebaseUids: string[] = [];
    let pageToken: string | undefined;
    do {
      const page = await firebase.listUsers(1000, pageToken);
      for (const record of page.users) {
        if (String(record.email || '').toLowerCase() !== SUPER_ADMIN_EMAIL) removeFirebaseUids.push(record.uid);
      }
      pageToken = page.pageToken;
    } while (pageToken);
    let deletedFirebaseUsers = 0;
    for (let i = 0; i < removeFirebaseUids.length; i += 1000) {
      const result = await firebase.deleteUsers(removeFirebaseUids.slice(i, i + 1000));
      deletedFirebaseUsers += result.successCount;
    }
    return json({ ok: true, deletedAppUsers: removeAppUsers.length, deletedFirebaseUsers });
  }],

  'GET /api/admin/incidents': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId); if (!current || current.role !== 'admin') return error('Admin access required',403);
    const result = await db.list<any>('incidents',{limit:200}); return json({incidents:result.items});
  }],

  'GET /api/admin/payments': [requireAppUser(), async ({ user }) => {
    const current = await getCurrentUserFromContext(user!.userId); if (!current || current.role !== 'admin') return error('Admin access required',403);
    const result = await db.list<any>('payments',{limit:200}); return json({payments:result.items});
  }],

  'POST /api/trip-shares': [requireAppUser(), async ({ body, user }) => {
    const input = body as Record<string,unknown>; const rideId=String(input.rideId||'');
    const [ride] = await db.get<any>('rides',[rideId]); if (!ride) return error('Ride not found',404);
    if (ride.passengerId!==user!.userId && ride.driverId!==user!.userId) return error('Forbidden',403);
    if (['Completed','Cancelled'].includes(ride.status)) return error('Only active rides can be shared',409);
    const token = crypto.randomUUID();
    const record={token,rideId,createdBy:user!.userId,createdAt:new Date().toISOString(),expiresAt:Date.now()+24*60*60*1000};
    const [id]=await db.add('trip_shares',[record]); if(!id) return error('Unable to create share link',500);
    return json({share:{...record,id},url:'/shared-trip/'+token},201);
  }],

  'GET /api/shared-trip/:token': [async ({params}) => {
    const result=await db.list<any>('trip_shares',{limit:200}); const share=result.items.find((s:any)=>s.token===params.token && s.expiresAt>Date.now());
    if(!share) return error('Share link expired or invalid',404); const [ride]=await db.get<any>('rides',[share.rideId]); if(!ride) return error('Trip not found',404);
    let driver=null; if(ride.driverId){ const [d]=await db.get<any>('drivers',[ride.driverId]); driver=d||null; }
    return json({ride,driver});
  }],

  'POST /api/ratings': [requireAppUser(), async ({ body, user }) => {
    const input = body as Record<string, unknown>;
    const rideId = String(input.rideId || '');
    const [ride] = await db.get<any>('rides', [rideId]);
    if (!ride || ride.passengerId !== user!.userId || ride.status !== 'Completed') return error('Only completed rides belonging to you can be rated', 403);
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return error('Rating must be between 1 and 5', 400);
    const existingRatings = await db.list<any>('ratings', { limit: 500 });
    if (existingRatings.items.some((item: any) => item.rideId === rideId && item.userId === user!.userId)) return error('This completed ride has already been rated', 409);
    const record = { rideId, rating, review: String(input.review || '').slice(0, 1000), driverId: ride.driverId || null, userId: user!.userId, createdAt: new Date().toISOString() };
    const [id] = await db.add('ratings', [record]);
    if (!id) return error('Unable to save rating', 500);
    if (record.driverId) {
      const driverRatings = existingRatings.items.filter((item: any) => item.driverId === record.driverId);
      const ratingTotal = driverRatings.reduce((sum: number, item: any) => sum + Number(item.rating || 0), 0) + rating;
      const ratingCount = driverRatings.length + 1;
      const averageRating = Math.round((ratingTotal / ratingCount) * 10) / 10;
      const [driver] = await db.get<any>('drivers', [record.driverId]);
      if (driver) {
        await db.update('drivers', [{ id: record.driverId, record: { ...driver, rating: averageRating, ratingCount } }]);
      }
      await notifyUser(driver?.userId, 'New driver rating', 'A passenger rated your completed Tridash trip ' + rating + '/5.', '/driver');
    }
    return json({ rating: { ...record, id }, driverRating: record.driverId ? { average: Math.round(((([...existingRatings.items.filter((item: any) => item.driverId === record.driverId), record]).reduce((sum: number, item: any) => sum + Number(item.rating || 0), 0)) / (existingRatings.items.filter((item: any) => item.driverId === record.driverId).length + 1)) * 10) / 10, count: existingRatings.items.filter((item: any) => item.driverId === record.driverId).length + 1 } : null }, 201);
  }],

  'POST /api/payments/paystack/initialize': [requireAppUser(), async ({ body, user, event }) => {
    const rideId = String((body as Record<string, unknown>)?.rideId || '');
    const [ride] = await db.get<any>('rides', [rideId]);
    if (!ride || ride.passengerId !== user!.userId) return error('Payment is not authorized for this ride', 403);
    if (ride.status !== 'Completed') return error('Online payment is available after the trip is completed', 409);
    if (ride.paymentStatus === 'Paid') return error('This ride has already been paid for', 409);
    const amountNaira = Number(ride.amount || 0);
    if (!Number.isInteger(amountNaira) || amountNaira <= 0) return error('Ride fare is invalid', 400);
    try {
      const reference = 'TRIDASH-' + ride.id.replace(/[^A-Za-z0-9.-]/g, '-') + '-' + Date.now();
      const callbackUrl = requestOrigin(event) + '/trips/' + encodeURIComponent(ride.id) + '?payment=paystack';
      const result = await paystackRequest('/transaction/initialize', { method: 'POST', body: JSON.stringify({ email: user!.email, amount: String(amountNaira * 100), currency: 'NGN', reference, callback_url: callbackUrl, channels: ['card', 'bank', 'ussd', 'qr', 'bank_transfer'], metadata: { rideId: ride.id, userId: user!.userId } }) });
      const paymentRecord = { rideId: ride.id, amount: amountNaira, method: 'Paystack', status: 'Pending', reference, userId: user!.userId, createdAt: new Date().toISOString() };
      const [paymentId] = await db.add('payments', [paymentRecord]);
      if (!paymentId) return error('Unable to create payment record', 500);
      return json({ authorizationUrl: result.data.authorization_url, reference, payment: { ...paymentRecord, id: paymentId } });
    } catch (e: any) {
      console.warn('Paystack initialization failed', e);
      return error(e?.message || 'Online payment could not be started. Check the Paystack configuration.', 502);
    }
  }],

  'GET /api/payments/paystack/verify': [requireAppUser(), async ({ query, user }) => {
    const reference = String(query?.reference || '');
    if (!reference) return error('Payment reference is required', 400);
    const payments = await db.list<any>('payments', { limit: 200 });
    const payment = payments.items.find((item: any) => item.reference === reference && item.userId === user!.userId);
    if (!payment) return error('Payment record not found', 404);
    if (payment.status === 'Paid') return json({ paid: true, payment });
    try {
      const result = await paystackRequest('/transaction/verify/' + encodeURIComponent(reference));
      const transaction = result.data;
      const [ride] = await db.get<any>('rides', [payment.rideId]);
      if (!ride || ride.passengerId !== user!.userId) return error('Payment ride is not authorized', 403);
      const expectedKobo = Math.round(Number(ride.amount || 0) * 100);
      if (transaction?.status !== 'success' || Number(transaction?.amount) !== expectedKobo || String(transaction?.currency || '').toUpperCase() !== 'NGN') return json({ paid: false, status: transaction?.status || 'unknown' });
      const paidRecord = { ...payment, status: 'Paid', method: 'Paystack', paidAt: transaction.paid_at || new Date().toISOString(), channel: transaction.channel || null, transactionId: transaction.id };
      const [ok] = await db.update('payments', [{ id: payment.id, record: paidRecord }]);
      if (!ok) return error('Unable to save verified payment', 500);
      const updatedRide = { ...ride, paymentMethod: 'Paystack', paymentStatus: 'Paid', paymentReference: reference };
      await db.update('rides', [{ id: ride.id, record: updatedRide }]);
      await notifySubscribers('rides', ride.id, { ...updatedRide, id: ride.id });
      return json({ paid: true, payment: { ...paidRecord, id: payment.id }, ride: { ...updatedRide, id: ride.id } });
    } catch (e: any) {
      console.warn('Paystack verification failed', e);
      return error(e?.message || 'Unable to verify the online payment', 502);
    }
  }],

  'POST /api/incidents': [requireAppUser(), async ({ body, user }) => {
    const current = await getCurrentUserFromContext(user!.userId);
    if (!current) return error('Authentication required', 401);
    if (current.role === 'admin') {
      const input = body as Record<string, unknown>;
      if (input.type !== 'admin-report') return error('Admin reports must use type admin-report', 400);
      const message = String(input.message || '').trim();
      if (message.length < 5) return error('Incident details are required', 400);
      const record = { type: 'admin-report', severity: String(input.severity || 'normal'), message: message.slice(0, 2000), userId: user!.userId, createdAt: new Date().toISOString() };
      const [id] = await db.add('incidents', [record]);
      if (!id) return error('Unable to record incident', 500);
      return json({ incident: { ...record, id } }, 201);
    }
    const input = body as Record<string, unknown>;
    const rideId = String(input.rideId || '');
    const [ride] = await db.get<any>('rides', [rideId]);
    if (!ride || ride.passengerId !== user!.userId) return error('Incident ride is not authorized', 403);
    const type = String(input.type || 'complaint');
    const message = String(input.message || '').trim();
    if (!['SOS', 'complaint'].includes(type)) return error('Unsupported incident type', 400);
    if (type === 'SOS') {
      if (['Completed', 'Cancelled'].includes(ride.status)) return error('SOS is only available during an active ride', 409);
      if (message.length < 5) return error('SOS details are required', 400);
      const record = { rideId, type: 'SOS', severity: 'high', message: message.slice(0, 1000), driverId: ride.driverId || null, userId: user!.userId, createdAt: new Date().toISOString() };
      const [id] = await db.add('incidents', [record]);
      if (!id) return error('Unable to record SOS', 500);
      if (ride.driverId) await notifyUser(ride.driverId, 'Tridash SOS alert', 'A passenger activated SOS on an active ride.', '/');
      return json({ incident: { ...record, id } }, 201);
    }
    if (message.length < 5) return error('Describe the issue in a little more detail', 400);
    const record = { rideId, type: 'complaint', severity: String(input.severity || 'normal'), message: message.slice(0, 2000), driverId: ride.driverId || null, userId: user!.userId, createdAt: new Date().toISOString() };
    const [id] = await db.add('incidents', [record]);
    if (!id) return error('Unable to record incident', 500);
    return json({ incident: { ...record, id } }, 201);
  }],

  ...realtimeSubscriptionRoutes,
});