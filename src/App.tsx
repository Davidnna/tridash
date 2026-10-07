import { useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from './api/client';
import { ws } from './api/websocket';
import { notifications } from './api/notifications';
import MapView from './MapView'; import RequestPageMap from './RequestPageMap';
import { firebaseAuth, onAuthStateChanged, resendVerification, refreshFirebaseUser, sendResetEmail, signInWithFirebase, signInWithGoogle, signOut, signUpWithFirebase } from './firebase';
import {
  Activity, AlertTriangle, Bell, CarFront, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3,
  CreditCard, FileCheck2, History, Home, LogOut, MapPin, Menu, MessageSquareWarning,
  Navigation, Phone, Plus, Search, Settings, Shield, ShieldAlert, ShieldCheck, Star,
  UserRound, Users, X, Zap
} from 'lucide-react';

type Role = 'passenger' | 'driver' | 'admin';
type RideStatus = 'Requested' | 'Accepted' | 'In Progress' | 'Completed' | 'Cancelled';
type Tab = 'home' | 'request' | 'trips' | 'safety' | 'profile' | 'requests' | 'admin';

type Ride = {
  id: string;
  passengerId?: string;
  passenger: string;
  driverId?: string | null;
  driver: string | null;
  pickup: string;
  destination: string;
  status: RideStatus;
  amount: number;
  paymentStatus?: 'Pending' | 'Paid' | 'Failed';
  paymentMethod?: string;
  rating?: number;
  review?: string;
  passengerPhone?: string;
  driverPhone?: string;
  riderName?: string;
  riderPhone?: string;
  bookedForSelf?: boolean;
  tricycle?: string;
  requestedAt?: string;
  acceptedAt?: string;
  startedAt?: string;
  completedAt?: string;
  pickupCoords?: {lat:number;lng:number};
  destinationCoords?: {lat:number;lng:number};
  rejectedByDriverIds?: string[];
};

type Driver = {
  id: string;
  userId?: string;
  name: string;
  phone: string;
  rating: number;
  verified: boolean;
  online: boolean;
  tricycle: string;
  documents: string[];
  status?: 'active' | 'suspended' | 'pending';
};

type Profile = {
  id?: string;
  name: string;
  phone: string;
  emergencyName: string;
  emergencyPhone: string;
  role: Role;
};

const fallbackRides: Ride[] = [
  { id: 'ride-101', passenger: 'Kelechi', driver: 'Chinedu', pickup: 'Presidential Road', destination: 'Akanu Ibiam Airport', status: 'Accepted', amount: 2500, tricycle: 'EB-214-KP', paymentStatus: 'Pending' },
  { id: 'ride-102', passenger: 'Amaka', driver: null, pickup: 'Abakpa Junction', destination: 'CAS Campus', status: 'Requested', amount: 1800, paymentStatus: 'Pending' },
  { id: 'ride-103', passenger: 'David', driver: 'Emeka', pickup: 'Waterworks', destination: 'Main Market', status: 'Completed', amount: 1500, rating: 5, paymentStatus: 'Paid', tricycle: 'EB-991-XQ' }
];

const fallbackDrivers: Driver[] = [
  { id: 'driver-1', name: 'Chinedu Okafor', phone: '0803 555 0142', rating: 4.9, verified: true, online: true, tricycle: 'EB-214-KP', documents: ['Government ID', 'Tricycle registration'], status: 'active' },
  { id: 'driver-2', name: 'Emeka Nwosu', phone: '0814 201 8820', rating: 4.7, verified: true, online: false, tricycle: 'EB-991-XQ', documents: ['Government ID', 'Tricycle registration'], status: 'active' },
  { id: 'driver-3', name: 'Ifeanyi Eze', phone: '0706 441 9021', rating: 0, verified: false, online: false, tricycle: 'EB-403-ZR', documents: ['Government ID', 'Tricycle registration'], status: 'pending' }
];

const navigateFromRoot = (navigate: ReturnType<typeof useNavigate>, pathname: string, target: string) => {
  const cleanTarget = target.replace(/^\/+/, '');
  const depth = pathname.split('/').filter(Boolean).length;
  navigate(cleanTarget ? '../'.repeat(depth) + cleanTarget : (depth ? '../'.repeat(depth) : '/'));
};

const defaultProfile: Profile = {
  name: '',
  phone: '',
  emergencyName: '',
  emergencyPhone: '',
  role: 'passenger'
};

function App() {
  const [role, setRole] = useState<Role>('passenger');
  const [workspaceMode, setWorkspaceMode] = useState<'rider' | 'driver' | 'admin'>('rider');
  const location = useLocation();
  const navigate = useNavigate();
  const rootNavigate = (target: string) => navigateFromRoot(navigate, location.pathname, target);
  const [tab, setTabState] = useState<Tab>('home');
  const setTab = (next: Tab) => {
    setTabState(next);
    if (next === 'home') {
      rootNavigate(workspaceMode === 'driver' ? 'driver' : workspaceMode === 'admin' ? 'admin' : '');
      return;
    }
    if (next === 'admin') {
      rootNavigate('admin');
      return;
    }
    if (next === 'requests') {
      rootNavigate('driver/requests');
      return;
    }
    if (next === 'request') {
      rootNavigate('request');
      return;
    }
    if (next === 'trips') {
      rootNavigate(workspaceMode === 'driver' ? 'driver/trips' : 'trips');
      return;
    }
    if (next === 'safety') {
      rootNavigate('safety');
      return;
    }
    if (next === 'profile') {
      rootNavigate(workspaceMode === 'driver' ? 'driver/profile' : 'profile');
    }
  };
  const [rides, setRides] = useState<Ride[]>(fallbackRides);
  const [drivers, setDrivers] = useState<Driver[]>(fallbackDrivers);
  const [driverProfile, setDriverProfile] = useState<Driver | null>(null);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [toast, setToast] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{title:string;message:string;confirmLabel:string;resolve:(value:boolean)=>void}|null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const topbarRef = useRef<HTMLElement | null>(null);
  const [authUser, setAuthUser] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationItems, setNotificationItems] = useState<any[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState<string | 'all' | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{lat:number;lng:number} | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    const path = location.pathname;
    const nextTab: Tab = path === '/request' ? 'request' : path === '/trips' ? 'trips' : path === '/safety' ? 'safety' : path === '/profile' ? 'profile' : path === '/driver/requests' ? 'requests' : path === '/driver/trips' ? 'trips' : path === '/driver/profile' ? 'profile' : path.startsWith('/admin') ? 'admin' : 'home';
    setTabState(nextTab);
    if (authUser?.role === 'driver' && path.startsWith('/driver')) setWorkspaceMode('driver');
    else if (authUser?.role === 'admin' && path.startsWith('/admin')) setWorkspaceMode('admin');
    else if (path === '/' || ['/request','/trips','/safety','/profile'].includes(path)) setWorkspaceMode('rider');
    if (!path.startsWith('/trips/')) setSelectedRide(null);
  }, [location.pathname, authUser?.role]);

  useEffect(() => {
    if (!menuOpen && !notificationOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.role-menu, .workspace-trigger, .notification-wrap')) return;
      setMenuOpen(false);
      setNotificationOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen, notificationOpen]);
  const [rating, setRating] = useState(5);
  const [review, setReview] = useState('');
  const socketRef = useRef<ReturnType<typeof ws.connect> | null>(null);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  const askConfirm = (title: string, message: string, confirmLabel = 'Continue') => new Promise<boolean>(resolve => setConfirmDialog({ title, message, confirmLabel, resolve }));

  useEffect(() => {
    let mounted = true;
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!mounted) return;
      if (!firebaseUser) {
        setAuthUser(null);
        setAuthReady(true);
        return;
      }
      if (!firebaseUser.emailVerified) {
        setAuthUser({ userId: firebaseUser.uid, email: firebaseUser.email || '', name: firebaseUser.displayName || '', role: 'passenger', emailVerified: false, firebaseUser });
        setAuthReady(true);
        return;
      }
      try {
        const idToken = await firebaseUser.getIdToken();
        const result = await api.post('/api/auth/firebase-session', { idToken, role: 'passenger' });
        if (!result.data?.user) throw new Error('Unable to establish Tridash session');
        setAuthUser({ ...result.data.user, firebaseUser });
        const nextRole = result.data.user.role || 'passenger';
        setRole(nextRole);
        setWorkspaceMode(nextRole === 'admin' ? 'admin' : nextRole === 'driver' ? 'driver' : 'rider');
        setTab(nextRole === 'admin' ? 'admin' : 'home');
        if (result.data.profile) setProfile(result.data.profile);
      } catch (error: any) {
        if (mounted) notify(error?.message || 'We could not establish your Tridash session.');
      } finally {
        if (mounted) setAuthReady(true);
      }
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const loadNotifications = async () => {
    if (!authUser?.userId) return;
    try {
      const result = await api.get('/api/notifications');
      if (Array.isArray(result.data?.notifications)) setNotificationItems(result.data.notifications);
    } catch {}
  };

  const unreadNotificationCount = notificationItems.filter(item => !item.read).length;

  const markNotificationRead = async (item: any) => {
    if (!item?.id || notificationBusy) return;
    setNotificationBusy(String(item.id));
    try {
      if (!item.read) {
        try { await api.post('/api/notifications/' + item.id + '/read'); } catch {}
        setNotificationItems(current => current.map(n => n.id === item.id ? { ...n, read: true } : n));
      }
      setNotificationOpen(false);
      if (item.url && String(item.url).startsWith('/')) rootNavigate(item.url);
    } finally {
      setNotificationBusy(null);
    }
  };

  const markAllNotificationsRead = async () => {
    if (notificationBusy) return;
    setNotificationBusy('all');
    try { await api.post('/api/notifications/read-all'); } catch {}
    setNotificationItems(current => current.map(n => ({ ...n, read: true })));
    setNotificationBusy(null);
  };

  useEffect(() => {
    if (!authUser) {
      setLoading(false);
      setNotificationItems([]);
      setNotificationOpen(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const [ridesRes, driversRes, profileRes, driverRes, notificationsRes] = await Promise.all([
          api.get('/api/rides'),
          api.get('/api/drivers'),
          api.get('/api/profile').catch(() => ({ data: null })),
          authUser.role === 'driver' ? api.get('/api/driver/me').catch(() => ({ data: null })) : Promise.resolve({ data: null }),
          api.get('/api/notifications').catch(() => ({ data: null }))
        ]);
        if (mounted && Array.isArray(ridesRes.data?.rides)) {
          setRides(ridesRes.data.rides);
          const current = ridesRes.data.rides.find((r: Ride) => ['Requested', 'Accepted', 'In Progress'].includes(r.status));
          setActiveRide(current || null);
        }
        if (mounted && Array.isArray(driversRes.data?.drivers) && driversRes.data.drivers.length) setDrivers(driversRes.data.drivers);
        if (mounted && profileRes.data?.profile) {
          setProfile(profileRes.data.profile);
          const profileRole = profileRes.data.profile.role as Role | undefined;
          setRole(authUser.role === 'admin' || authUser.role === 'driver' ? authUser.role : profileRole || authUser.role || 'passenger');
        }
        if (mounted && driverRes.data?.driver) setDriverProfile(driverRes.data.driver);
        if (mounted && Array.isArray(notificationsRes.data?.notifications)) setNotificationItems(notificationsRes.data.notifications);
      } catch {}
      if (mounted) setLoading(false);
    })();
    const refreshTimer = window.setInterval(() => { loadNotifications(); }, 15000);
    return () => { mounted = false; window.clearInterval(refreshTimer); };
  }, [authUser?.userId]);

  useEffect(() => {
    const conn = ws.connect();
    socketRef.current = conn;
    conn.onMessage((message: any) => {
      if (message?.type !== 'entity.update') return;
      const entityType = message.entity_type || message.payload?.entity_type;
      const payload = message.payload?.data || message.payload || message.data;
      if (entityType === 'rides' && payload?.id) {
        setRides(current => current.some(r => r.id === payload.id)
          ? current.map(r => r.id === payload.id ? payload : r)
          : [payload, ...current]);
        if (payload.status !== 'Completed' && payload.status !== 'Cancelled') setActiveRide(payload);
      }
      if (entityType === 'drivers' && payload?.id) {
        setDrivers(current => current.map(d => d.id === payload.id ? { ...d, ...payload } : d));
        if (payload.lastLocation) setDriverLocation(payload.lastLocation);
        if (payload.lastLocation === null) setDriverLocation(null);
      }
    });
    conn.onError(() => {});
    return () => conn.disconnect();
  }, []);

  useEffect(() => {
    if (!authUser?.userId || role !== 'driver' || !activeRide || ['Completed','Cancelled'].includes(activeRide.status)) return;
    if (!navigator.geolocation) {
      notify('Live GPS is not available in this browser.');
      return;
    }
    const watch = navigator.geolocation.watchPosition(async position => {
      const currentLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
      setDriverLocation(currentLocation);
      try { await api.post('/api/driver/location', { rideId: activeRide.id, ...currentLocation }); } catch {}
    }, () => notify('Allow location access to share your live position during the trip.'), { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
    return () => navigator.geolocation.clearWatch(watch);
  }, [authUser?.userId, role, activeRide?.id, activeRide?.status]);

  useEffect(() => {
    if (!socketRef.current) return;
    const rideId = activeRide?.id;
    const driverId = activeRide?.driverId;
    if (!rideId) return;
    const connection = socketRef.current;
    let cancelled = false;
    let unsubscribeRide: (() => void) | undefined;
    let unsubscribeDriver: (() => void) | undefined;

    connection.ready.then(() => {
      if (cancelled) return;
      unsubscribeRide = ws.subscribe('rides', rideId);
      if (driverId) unsubscribeDriver = ws.subscribe('drivers', driverId);
    });

    return () => {
      cancelled = true;
      unsubscribeRide?.();
      unsubscribeDriver?.();
    };
  }, [activeRide?.id, activeRide?.driverId]);

  const syncFirebaseSession = async (firebaseUser: any, accountRole: 'passenger' | 'driver' = 'passenger') => {
    const idToken = await firebaseUser.getIdToken();
    const result = await api.post('/api/auth/firebase-session', { idToken, role: accountRole });
    if (!result.data?.user) throw new Error('Unable to establish Tridash session');
    setAuthUser({ ...result.data.user, firebaseUser });
    const nextRole = result.data.user.role || accountRole;
    setRole(nextRole);
    setWorkspaceMode(nextRole === 'admin' ? 'admin' : nextRole === 'driver' ? 'driver' : 'rider');
    setTab(nextRole === 'admin' ? 'admin' : 'home');
    if (result.data.profile) setProfile(result.data.profile);
    return result.data.user;
  };

  const authErrorMessage = (error: any) => {
    const code = String(error?.code || '');
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'The email or password is incorrect.';
    if (code.includes('email-already-in-use')) return 'An account already exists with this email. Try signing in instead.';
    if (code.includes('weak-password')) return 'Choose a stronger password. Firebase requires a valid password for the account.';
    if (code.includes('invalid-email')) return 'Enter a valid email address.';
    if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a moment and try again.';
    if (code.includes('operation-not-allowed')) return 'Email/password authentication is not enabled in Firebase.';
    return error?.message || 'Authentication could not be completed.';
  };

  const signIn = async (email: string, password: string) => {
    setAuthBusy(true);
    try {
      const firebaseUser = await signInWithFirebase(email, password);
      if (!firebaseUser.emailVerified) {
        setAuthUser({ userId: firebaseUser.uid, email: firebaseUser.email || email, name: firebaseUser.displayName || '', role: 'passenger', emailVerified: false, firebaseUser });
        notify('Please verify your email before entering Tridash.');
        return true;
      }
      await syncFirebaseSession(firebaseUser);
      notify('Welcome back to Tridash');
      return true;
    } catch (error: any) {
      notify(authErrorMessage(error));
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const signUp = async (name: string, email: string, password: string, accountRole: 'passenger' | 'driver') => {
    setAuthBusy(true);
    try {
      const firebaseUser = await signUpWithFirebase(name, email, password);
      setAuthUser({ userId: firebaseUser.uid, email: firebaseUser.email || email, name: firebaseUser.displayName || name, role: accountRole, emailVerified: false, firebaseUser });
      setRole(accountRole);
      notify('Account created. Check your email to verify it.');
      return true;
    } catch (error: any) {
      notify(authErrorMessage(error));
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const signInGoogle = async () => {
    setAuthBusy(true);
    try {
      const firebaseUser = await signInWithGoogle();
      if (!firebaseUser.emailVerified) {
        setAuthUser({ userId: firebaseUser.uid, email: firebaseUser.email || '', name: firebaseUser.displayName || '', role: 'passenger', emailVerified: false, firebaseUser });
        notify('Please verify your email before entering Tridash.');
        return true;
      }
      await syncFirebaseSession(firebaseUser);
      notify('Signed in with Google');
      return true;
    } catch (error: any) {
      notify(authErrorMessage(error));
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const resetPassword = async (email: string) => {
    setAuthBusy(true);
    try {
      await sendResetEmail(email);
      notify('Password reset email sent. Check your inbox.');
      return true;
    } catch (error: any) {
      notify(authErrorMessage(error));
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const saveProfile = async (next: Profile) => {
    if (profileBusy) return;
    setProfileBusy(true);
    setProfile(next);
    try {
      await api.post('/api/profile', next);
      notify('Profile saved');
    } catch { notify('Profile could not be saved. Please try again.'); }
    finally { setProfileBusy(false); }
  };

  const requestRide = async (pickup: string, destination: string, amount: number, pickupCoords?: {lat:number;lng:number}, destinationCoords?: {lat:number;lng:number}, rider?: {name:string;phone:string;bookedForSelf:boolean}) => {
    if (!profile.phone.trim()) { notify('Add your phone number in Profile before booking a ride.'); setTab('profile'); return; }
    if (!rider?.phone?.trim()) { notify('A rider phone number is required before booking.'); return; }
    const ride: Ride = {
      id: 'ride-' + Date.now(),
      passengerId: authUser?.userId,
      passenger: rider?.name?.trim() || profile.name || authUser?.name || 'Passenger',
      passengerPhone: rider?.phone?.trim() || profile.phone.trim(),
      riderName: rider?.name?.trim() || profile.name || authUser?.name || 'Passenger',
      riderPhone: rider?.phone?.trim() || profile.phone.trim(),
      bookedForSelf: rider?.bookedForSelf !== false,
      driverId: null,
      driver: null,
      pickup,
      destination,
      pickupCoords,
      destinationCoords,
      status: 'Requested',
      amount,
      paymentStatus: 'Pending',
      requestedAt: new Date().toISOString()
    };
    try {
      const res = await api.post('/api/rides', ride);
      const savedRide = res.data?.ride || ride;
      setRides(current => [savedRide, ...current.filter(item => item.id !== savedRide.id)]);
      setActiveRide(savedRide);
      setTab('home');
      notify('Ride requested. Finding a verified driver...');
    } catch {
      notify('We could not save the ride request. Please try again.');
    }
  };

  const updateRide = async (ride: Ride, status: RideStatus, driverName?: string, driverId?: string) => {
    const updated: Ride = {
      ...ride,
      status,
      driver: driverName ?? ride.driver,
      driverId: driverId ?? ride.driverId,
      acceptedAt: status === 'Accepted' ? new Date().toISOString() : ride.acceptedAt,
      startedAt: status === 'In Progress' ? new Date().toISOString() : ride.startedAt,
      completedAt: status === 'Completed' ? new Date().toISOString() : ride.completedAt
    };
    setRides(current => current.map(r => r.id === updated.id ? updated : r));
    setActiveRide(updated);
    setSelectedRide(updated);
    try { const res = await api.put('/api/rides/' + updated.id, updated); if (res.data?.ride) { setRides(current => current.map(r => r.id === updated.id ? res.data.ride : r)); setActiveRide(res.data.ride); } } catch { notify('We could not save this trip update. Please try again.'); return; }
    notify(status === 'Completed' ? 'Trip completed' : 'Trip status updated');
    if (status === 'Completed') setShowRating(true);
  };

  const cancelRide = async (ride: Ride) => {
    const confirmed = await askConfirm('Cancel this ride?', 'This ride will be marked as cancelled and will no longer be treated as an active trip.', 'Cancel ride');
    if (!confirmed) return;
    try {
      const res = await api.post('/api/rides/' + encodeURIComponent(ride.id) + '/cancel', {});
      const savedRide = res.data?.ride;
      if (!savedRide) throw new Error('Cancellation failed');
      setRides(current => current.map(item => item.id === ride.id ? savedRide : item));
      setActiveRide(null);
      setSelectedRide(null);
      notify('Ride cancelled. It is no longer an active trip.');
      rootNavigate('trips');
    } catch (error: any) {
      notify(error?.message || 'We could not cancel this ride. Please try again.');
    }
  };

  const submitRating = async () => {
    if (!activeRide) return;
    try {
      const result = await api.post('/api/ratings', { rideId: activeRide.id, rating, review, driverId: activeRide.driverId });
      const savedRating = result.data?.rating;
      const updated = { ...activeRide, rating: savedRating?.rating ?? rating, review: savedRating?.review ?? review, paymentStatus: activeRide.paymentStatus };
      setRides(current => current.map(r => r.id === updated.id ? updated : r));
      setActiveRide(updated);
      setShowRating(false);
      notify('Thanks for rating your trip');
    } catch (error: any) {
      notify(error?.message || 'We could not save your rating. Please try again.');
    }
  };

  const sendSOS = async () => {
    if (!activeRide) return;
    try {
      await api.post('/api/incidents', { rideId: activeRide.id, type: 'SOS', severity: 'high', message: 'Passenger activated SOS', createdAt: new Date().toISOString() });
      notify('SOS recorded. Operations and your emergency contact have been notified where notifications are enabled.');
    } catch { notify('SOS could not be recorded. Try again or call emergency services directly.'); }
  };

  const shareTrip = async () => {
    if (!activeRide) return;
    const text = 'Tridash trip: ' + activeRide.pickup + ' → ' + activeRide.destination + ' | Status: ' + activeRide.status + (activeRide.driver ? ' | Driver: ' + activeRide.driver : '');
    try {
      const res = await api.post('/api/trip-shares', { rideId: activeRide.id });
      const shareTarget = res.data?.url || '/?ride=' + encodeURIComponent(activeRide.id);
      const sharePath = shareTarget.startsWith('/') ? shareTarget : '/' + shareTarget;
      const shareUrl = new URL(sharePath, window.location.origin).href;
      if (navigator.share) await navigator.share({ title: 'Track my Tridash trip', text, url: shareUrl });
      else await navigator.clipboard.writeText(shareUrl + '\\n' + text);
      notify('Trip tracking link ready to share');
    } catch { try { await navigator.clipboard.writeText(text); notify('Trip details copied'); } catch { notify('Trip sharing is unavailable on this device'); } }
  };

  const payRide = async (ride: Ride) => {
    setPaymentBusy(true);
    try {
      const res = await api.post('/api/payments/paystack/initialize', { rideId: ride.id });
      const authorizationUrl = res.data?.authorizationUrl;
      if (!authorizationUrl) throw new Error('Paystack checkout could not be created');
      window.location.assign(authorizationUrl);
    } catch (error: any) {
      setPaymentBusy(false);
      notify(error?.message || 'Online payment could not be started.');
    }
  };

  const approveDriver = async (driver: Driver) => {
    const updated = { ...driver, verified: true, status: 'active' as const };
    setDrivers(current => current.map(d => d.id === driver.id ? updated : d));
    try { const res = await api.put('/api/drivers/' + driver.id, { verified: true, status: 'active', online: false }); if (res.data?.driver) setDrivers(current => current.map(d => d.id === driver.id ? res.data.driver : d)); notify(driver.name + ' approved'); } catch { notify('Driver approval could not be saved.'); }
  };

  const updateUserRole = async (userId: string, nextRole: Role) => {
    try { const res = await api.put('/api/admin/users/' + userId, { role: nextRole }); if (res.data?.user) notify('User role updated to ' + nextRole); return true; } catch { notify('User role could not be changed.'); return false; }
  };

  const suspendUser = async (userId: string, suspended: boolean) => {
    try { await api.put('/api/admin/users/' + userId, { status: suspended ? 'suspended' : 'active' }); notify(suspended ? 'User suspended' : 'User reactivated'); return true; } catch { notify('User status could not be changed.'); return false; }
  };

  const toggleDriverOnline = async () => {
    if (!driverProfile) return notify('Complete your driver profile first.');
    if (!driverProfile.verified) return notify('Your driver account must be verified before going online.');
    const updated = { ...driverProfile, online: !driverProfile.online };
    setDriverProfile(updated);
    setDrivers(current => current.map(d => d.id === updated.id ? updated : d));
    try { const res = await api.put('/api/driver/me', { online: updated.online }); if (res.data?.driver) setDriverProfile(res.data.driver); }
    catch { setDriverProfile(driverProfile); notify('Your online status could not be saved.'); return; }
    notify(updated.online ? 'You are now online' : 'You are now offline');
  };

  const rejectRide = async (ride: Ride) => {
    try {
      await api.post('/api/rides/' + ride.id + '/reject', {});
      setRides(current => current.map(r => r.id === ride.id ? { ...r, rejectedByDriverIds: [...new Set([...(r.rejectedByDriverIds || []), driverProfile?.id || driverProfile?.userId || ''])] } : r));
      notify('Ride declined. It remains available to other drivers.');
    } catch (error: any) { notify(error?.message || 'Ride could not be declined.'); }
  };

  const acceptRide = async (ride: Ride) => {
    let currentDriver = driverProfile;
    if (!currentDriver) { const response = await api.get('/api/driver/me').catch(() => ({ data: null })); currentDriver = response.data?.driver || null; if (currentDriver) setDriverProfile(currentDriver); }
    if (!currentDriver) return notify('Driver profile not found. Please refresh your driver workspace.');
    if (!currentDriver.verified) return notify('Your driver profile is still awaiting verification.');
    if (!currentDriver.online) return notify('Go online before accepting a passenger request.');
    try {
      const latestResponse = await api.get('/api/rides');
      const latestRide = latestResponse.data?.rides?.find((item: Ride) => item.id === ride.id) || ride;
      if (latestRide.status !== 'Requested') {
        notify(latestRide.status === 'Cancelled' ? 'This passenger cancelled the ride.' : latestRide.driver ? 'This ride has already been accepted by another driver.' : 'This ride is no longer available.');
        return false;
      }
      const res = await api.post('/api/rides/' + ride.id + '/accept', {});
      if (res.data?.ride) {
        setRides(current => current.map(r => r.id === ride.id ? res.data.ride : r));
        setActiveRide(res.data.ride);
        notify('Ride accepted. Passenger has been notified.');
        return true;
      }
    } catch (error: any) {
      const serverMessage = error?.response?.data?.error || error?.response?.data?.message;
      notify(serverMessage || error?.message || 'Ride is no longer available.');
    }
    return false;
  };

  const enableNotifications = async () => {
    try {
      await notifications.subscribe();
      setNotificationsEnabled(true);
      notify('Notifications enabled');
    } catch { notify('Notifications could not be enabled on this device'); }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const reference = params.get('reference');
    if (!authUser?.userId || params.get('payment') !== 'paystack' || !reference) return;
    let cancelled = false;
    setPaymentBusy(true);
    api.get('/api/payments/paystack/verify?reference=' + encodeURIComponent(reference)).then(res => {
      if (cancelled) return;
      if (res.data?.paid && res.data?.ride) {
        const savedRide = res.data.ride;
        setRides(current => current.map(r => r.id === savedRide.id ? savedRide : r));
        setActiveRide(savedRide);
        notify('Online payment verified successfully.');
        rootNavigate('trips/' + encodeURIComponent(savedRide.id));
      } else {
        notify('Payment was not completed or could not be verified.');
        rootNavigate(location.pathname);
      }
    }).catch((error: any) => { if (!cancelled) notify(error?.message || 'Online payment verification failed.'); })
      .finally(() => { if (!cancelled) setPaymentBusy(false); });
    return () => { cancelled = true; };
  }, [authUser?.userId, location.search]);

  const riderTrips = authUser?.userId ? rides.filter(r => r.passengerId === authUser.userId) : [];
  const activeForPassenger = riderTrips.find(r => !['Completed', 'Cancelled'].includes(r.status)) || null;
  const myTrips = riderTrips;
  const requests = rides.filter(r => r.status === 'Requested');
  const pendingDrivers = drivers.filter(d => !d.verified);

  const renderPassenger = (routeTab: Tab) => <PassengerWorkspace tab={routeTab} setTab={setTab} profile={profile} activeRide={activeForPassenger} myTrips={myTrips} requestRide={requestRide} updateRide={updateRide} cancelRide={cancelRide} sendSOS={sendSOS} shareTrip={shareTrip} driverLocation={driverLocation} payRide={payRide} paymentBusy={paymentBusy} saveProfile={saveProfile} profileBusy={profileBusy} notify={notify} showRating={showRating} setShowRating={setShowRating} rating={rating} setRating={setRating} review={review} setReview={setReview} submitRating={submitRating} notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} selectedRide={selectedRide} setSelectedRide={setSelectedRide} />;
  const renderDriver = (routeTab: Tab) => <DriverWorkspace tab={routeTab} setTab={setTab} driver={driverProfile || drivers.find(d => d.userId === authUser?.userId) || { id: 'pending-driver', userId: authUser?.userId, name: profile.name || authUser?.name || 'Driver', phone: profile.phone || '', rating: 0, verified: false, online: false, tricycle: '', documents: [], status: 'pending' }} requests={requests} activeRide={activeRide} rides={rides} updateRide={updateRide} acceptRide={acceptRide} rejectRide={rejectRide} toggleOnline={toggleDriverOnline} notify={notify} saveProfile={saveProfile} profile={profile} driverLocation={driverLocation} />;

  if (!authReady) return <div className="loading-screen"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><p>Checking your secure session…</p></div>;
  if (!authUser) return <AuthScreen busy={authBusy} onSignIn={signIn} onSignUp={signUp} onGoogleSignIn={signInGoogle} onResetPassword={resetPassword} />;
  if (!authUser.emailVerified) return <VerificationScreen busy={authBusy} firebaseUser={authUser.firebaseUser} onVerified={async (refreshed: any) => { setAuthBusy(true); try { await syncFirebaseSession(refreshed, authUser.role === 'driver' ? 'driver' : 'passenger'); notify('Email verified. Welcome to Tridash.'); } finally { setAuthBusy(false); } }} onRefresh={async () => { setAuthBusy(true); try { const refreshed = await refreshFirebaseUser(authUser.firebaseUser); if (refreshed?.emailVerified) { await syncFirebaseSession(refreshed, authUser.role === 'driver' ? 'driver' : 'passenger'); notify('Email verified. Welcome to Tridash.'); } else { notify('Your email is not verified yet. Open the verification link, then try again.'); } } catch (error: any) { notify(error?.message || 'We could not refresh your verification status.'); } finally { setAuthBusy(false); } }} onResend={async () => { try { await resendVerification(authUser.firebaseUser); notify('Verification email sent again. Check spam or junk if you do not see it.'); } catch (error: any) { notify(error?.message || 'Unable to resend the verification email.'); } }} onSignOut={async () => { await api.post('/api/auth/logout').catch(() => {}); await signOut(firebaseAuth); setAuthUser(null); setAuthReady(true); }} />;
  if (loading) return <div className="loading-screen"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><p>Loading your safe-ride workspace…</p></div>;

  const switchWorkspace = (next: 'rider' | 'driver' | 'admin') => {
    if (next === 'driver' && role !== 'driver') return;
    if (next === 'admin' && role !== 'admin') return;
    setWorkspaceMode(next);
    setMenuOpen(false);
    setNotificationOpen(false);
    setSelectedRide(null);
    setTabState('home');
    rootNavigate(next === 'driver' ? 'driver' : next === 'admin' ? 'admin' : '');
  };

  const goWorkspaceHome = () => switchWorkspace(workspaceMode);

  return (
    <div className="app-shell">
      <header className="topbar" ref={topbarRef}>
        <button className="brand" aria-label="Go to workspace home" onClick={goWorkspaceHome}><span className="brand-mark"><Zap size={18} /></span><span>tridash</span></button>
        <div className="topbar-actions">
          {role !== 'passenger' && <button className="workspace-trigger" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><span className="workspace-trigger-text"><span className="workspace-trigger-label">WORKSPACE</span><strong>{workspaceMode === 'admin' ? 'Admin' : workspaceMode === 'driver' ? 'Driver' : 'Rider'}</strong></span><ChevronDown size={15} /></button>}
          <div className="notification-wrap">
            <button className="icon-button notification-button" title="Notifications" aria-label="Notifications" aria-expanded={notificationOpen} onClick={() => { setNotificationOpen(v => !v); setMenuOpen(false); }}><Bell size={18} />{unreadNotificationCount > 0 && <span className="notification-badge">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}</button>
            {notificationOpen && <div className="notification-popover" role="dialog" aria-label="Notifications">
              <div className="notification-head"><div><span className="eyebrow">INBOX</span><strong>Notifications</strong></div>{unreadNotificationCount > 0 && <button className="text-button-inline" disabled={notificationBusy !== null} aria-busy={notificationBusy === 'all'} onClick={markAllNotificationsRead}>{notificationBusy === 'all' ? 'Marking…' : 'Mark all read'}</button>}</div>
              <div className="notification-list">{notificationItems.length ? notificationItems.slice(0, 12).map(item => <button key={item.id} className={'notification-item '+(item.read ? '' : 'unread')} onClick={() => markNotificationRead(item)}><span className="notification-icon"><Bell size={15}/></span><span className="notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small></span></button>) : <div className="notification-empty"><Bell size={20}/><span>No notifications yet.</span></div>}</div>
            </div>}
          </div>
          <button className="icon-button" title="Sign out" onClick={async () => { await api.post('/api/auth/logout').catch(() => {}); await signOut(firebaseAuth); setAuthUser(null); setAuthReady(true); setRole('passenger'); setWorkspaceMode('rider'); rootNavigate(''); notify('Signed out'); }}><LogOut size={18} /></button>
        </div>
      </header>
      {role !== 'passenger' && menuOpen && <div className="role-menu" role="menu"><div className="eyebrow">SWITCH WORKSPACE</div>
        <button className={workspaceMode === 'rider' ? 'workspace-option active' : 'workspace-option'} onClick={() => switchWorkspace('rider')}><strong>Rider mode</strong><span>Book and manage rides</span></button>
        {role === 'driver' && <button className={workspaceMode === 'driver' ? 'workspace-option active' : 'workspace-option'} onClick={() => switchWorkspace('driver')}><strong>Driver mode</strong><span>Accept and operate rides</span></button>}
        {role === 'admin' && <button className={workspaceMode === 'admin' ? 'workspace-option active' : 'workspace-option'} onClick={() => switchWorkspace('admin')}><strong>Admin mode</strong><span>Manage Tridash operations</span></button>}
      </div>}
      <Routes>
        <Route path="" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} /> : workspaceMode === 'driver' ? renderDriver('home') : renderPassenger('home')} />
        <Route path="request" element={renderPassenger('request')} />
        <Route path="trips" element={renderPassenger('trips')} />
        <Route path="trips/:rideId" element={<RideRoute rides={rides} setSelectedRide={setSelectedRide} payRide={payRide} driverLocation={driverLocation} cancelRide={cancelRide} />} />
        <Route path="shared-trip/:token" element={<SharedTripRoute />} />
        <Route path="safety" element={renderPassenger('safety')} />
        <Route path="profile" element={renderPassenger('profile')} />
        <Route path="driver" element={workspaceMode === 'driver' ? renderDriver('home') : renderPassenger('home')} />
        <Route path="driver/requests" element={workspaceMode === 'driver' ? renderDriver('requests') : renderPassenger('home')} />
        <Route path="driver/trips" element={workspaceMode === 'driver' ? renderDriver('trips') : renderPassenger('home')} />
        <Route path="driver/trips/:rideId" element={workspaceMode === 'driver' ? <RideRoute rides={rides} setSelectedRide={setSelectedRide} payRide={payRide} driverLocation={driverLocation} backTarget="driver/trips" /> : renderPassenger('home')} />
        <Route path="driver/profile" element={workspaceMode === 'driver' ? renderDriver('profile') : renderPassenger('home')} />
        <Route path="admin" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} /> : renderPassenger('home')} />
        <Route path="admin/users" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="users" /> : renderPassenger('home')} />
        <Route path="admin/drivers" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="drivers" /> : renderPassenger('home')} />
        <Route path="admin/rides" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="rides" /> : renderPassenger('home')} />
        <Route path="admin/reports" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="reports" /> : renderPassenger('home')} />
        <Route path="admin/payments" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="payments" /> : renderPassenger('home')} />
        <Route path="admin/settings" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="settings" /> : renderPassenger('home')} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} onCancel={() => { const resolve = confirmDialog.resolve; setConfirmDialog(null); resolve(false); }} onConfirm={() => { const resolve = confirmDialog.resolve; setConfirmDialog(null); resolve(true); }} />}
    </div>
  );
}

function NotFoundPage() {
  const navigate = useNavigate();
  return <div className="mobile-frame"><div className="empty-card not-found-card"><div className="empty-icon"><Search size={24}/></div><div className="eyebrow">404</div><h2>Page not found</h2><p>The Tridash page you requested does not exist or may have moved.</p><button className="primary-button" onClick={() => navigate('..')}>Return to Tridash</button></div></div>;
}

function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: { title:string; message:string; confirmLabel:string; onCancel:()=>void; onConfirm:()=>void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h3 id="confirm-title">{title}</h3><p>{message}</p><div className="confirm-actions"><button className="secondary-button" onClick={onCancel}>Keep it</button><button className="primary-button danger-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}

function SharedTripRoute() {
  const { token } = useParams();
  const [state, setState] = useState<{loading:boolean; ride:Ride|null; driver:any; error:string}>({loading:true, ride:null, driver:null, error:''});
  useEffect(() => {
    let mounted = true;
    api.get('/api/shared-trip/' + encodeURIComponent(token || '')).then(res => {
      if (mounted) setState({loading:false, ride:res.data?.ride || null, driver:res.data?.driver || null, error:''});
    }).catch((error: any) => {
      if (mounted) setState({loading:false, ride:null, driver:null, error:error?.message || 'This tracking link is no longer available.'});
    });
    return () => { mounted = false; };
  }, [token]);
  if (state.loading) return <div className="loading-screen"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><p>Loading shared trip…</p></div>;
  if (state.error || !state.ride) return <div className="mobile-frame"><div className="empty-card"><div className="empty-icon"><Search size={22}/></div><h2>Trip link unavailable</h2><p>{state.error || 'This shared trip could not be found.'}</p></div></div>;
  return <div className="mobile-frame"><div className="eyebrow">SHARED TRIP</div><h2 className="shared-trip-title">{state.ride.status}</h2><div className="status-card"><div className="status-icon"><Navigation size={24} /></div><div><strong>{state.ride.pickup} → {state.ride.destination}</strong><p>Estimated fare · ₦{Number(state.ride.amount || 0).toLocaleString()}</p></div></div><MapView pickup={state.ride.pickupCoords} destination={state.ride.destinationCoords} driverLocation={state.driver?.lastLocation || null} /><div className="driver-card"><div className="avatar">{String(state.driver?.name || state.ride.driver || 'TR').slice(0,2).toUpperCase()}</div><div className="driver-info"><strong>{state.driver?.name || state.ride.driver || 'Driver pending'}</strong><span>{state.driver?.tricycle || 'Tridash driver'} · {state.ride.status}</span></div></div><p className="hint">This link is temporary and only shares the trip information needed for tracking.</p></div>;
}

function RideRoute({ rides, setSelectedRide, payRide, paymentBusy, driverLocation, cancelRide, backTarget = 'trips' }: { rides:Ride[]; setSelectedRide:(ride:Ride|null)=>void; payRide:any; paymentBusy:boolean; driverLocation:any; cancelRide?:any; backTarget?:string }) {
  const { rideId } = useParams();
  const ride = rides.find(item => item.id === decodeURIComponent(rideId || ''));
  if (!ride) return <div className="mobile-frame"><div className="empty-card"><div className="empty-icon"><Search size={22}/></div><h2>Trip not found</h2><p>This trip is no longer available.</p><button className="primary-button" onClick={() => setSelectedRide(null)}>Return to trips</button></div></div>;
  return <RideDetail ride={ride} setSelectedRide={setSelectedRide} payRide={payRide} paymentBusy={paymentBusy} driverLocation={driverLocation} cancelRide={cancelRide} backTarget={backTarget} />;
}

function AuthScreen({ busy, onSignIn, onSignUp, onGoogleSignIn, onResetPassword }: { busy: boolean; onSignIn: (email: string, password: string) => Promise<boolean>; onSignUp: (name: string, email: string, password: string, role: 'passenger' | 'driver') => Promise<boolean>; onGoogleSignIn: () => Promise<boolean>; onResetPassword: (email: string) => Promise<boolean> }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [errorText, setErrorText] = useState('');
  const [forgotMode, setForgotMode] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorText('');
    if (mode === 'signup' && name.trim().length < 2) {
      setErrorText('Enter your full name.');
      return;
    }
    if (!email.trim()) {
      setErrorText('Enter your email address.');
      return;
    }
    if (password.length < 8) {
      setErrorText('Password must be at least 8 characters.');
      return;
    }
    const ok = mode === 'signin'
      ? await onSignIn(email.trim(), password)
      : await onSignUp(name.trim(), email.trim(), password, role);
    if (!ok) setErrorText(mode === 'signin' ? 'We could not sign you in with those details.' : 'We could not create the account. Please check the details and try again.');
  };

  if (forgotMode) return <div className="auth-shell"><div className="auth-panel"><div className="auth-brand"><span className="brand-mark"><Zap size={18} /></span><strong>tridash</strong></div><div className="eyebrow">ACCOUNT RECOVERY</div><h1>Reset your password.</h1><p className="auth-intro">Firebase will send a secure password-reset email to your address.</p><form className="auth-form" onSubmit={async event => { event.preventDefault(); if (!email.trim()) { setErrorText('Enter your email address.'); return; } await onResetPassword(email.trim()); }}><label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>{errorText && <div className="auth-error"><AlertTriangle size={16} />{errorText}</div>}<button className="primary-button full auth-submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset email'}</button><button type="button" className="secondary-button full" onClick={() => { setForgotMode(false); setErrorText(''); }}>Back to sign in</button></form></div></div>;

  return <div className="auth-shell">
    <div className="auth-panel">
      <div className="auth-brand"><span className="brand-mark"><Zap size={18} /></span><strong>tridash</strong></div>
      <div className="eyebrow">SAFE RIDE ACCESS</div>
      <h1>{mode === 'signin' ? 'Welcome back.' : 'Create your Tridash account.'}</h1>
      <p className="auth-intro">Sign in directly to Tridash with Firebase. You do not need an AppDeploy account.</p>
      <div className="auth-switch"><button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setErrorText(''); }}>Sign in</button><button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setErrorText(''); }}>Create account</button></div>
      <button type="button" className="secondary-button full" disabled={busy} onClick={async () => { const ok = await onGoogleSignIn(); if (!ok) setErrorText('Google sign-in could not be completed.'); }}><span>G</span> Continue with Google</button>
      <div className="auth-divider"><span>or use email</span></div>
      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && <label>Full name<input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" autoComplete="name" /></label>}
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
        {mode === 'signup' && <label>Account type<select value={role} onChange={e => setRole(e.target.value as 'passenger' | 'driver')}><option value="passenger">Passenger</option><option value="driver">Driver</option></select></label>}
        {errorText && <div className="auth-error"><AlertTriangle size={16} />{errorText}</div>}
        <button className="primary-button full auth-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in to Tridash' : 'Create Tridash account'}</button>
      </form>
      {mode === 'signin' && <button className="text-button" type="button" onClick={() => { setForgotMode(true); setErrorText(''); }}>Forgot password?</button>}
      <div className="auth-note"><ShieldCheck size={16} /><span>Firebase handles your password, sign-in and account recovery. Tridash never stores your password.</span></div>
    </div>
  </div>;
}

function VerificationScreen({ busy, firebaseUser, onVerified, onRefresh, onResend, onSignOut }: { busy: boolean; firebaseUser: any; onRefresh: () => Promise<void>; onResend: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (cancelled || busy || !firebaseUser) return;
      setChecking(true);
      try {
        const refreshed = await refreshFirebaseUser(firebaseUser);
        if (!cancelled && refreshed?.emailVerified) await onVerifiedRef.current(refreshed);
      } catch {}
      if (!cancelled) setChecking(false);
    };
    const interval = window.setInterval(check, 4000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [firebaseUser, busy]);

  const handleResend = async () => {
    setResending(true);
    try { await onResend(); } finally { setResending(false); }
  };

  return <div className="auth-shell"><div className="auth-panel"><div className="auth-brand"><span className="brand-mark"><Zap size={18} /></span><strong>tridash</strong></div><div className="eyebrow">VERIFY YOUR EMAIL</div><h1>Check your inbox.</h1><p className="auth-intro">We sent a verification link to <strong>{firebaseUser?.email || 'your email address'}</strong>. Open it, then return here. Tridash checks automatically every few seconds.</p><button className="primary-button full" disabled={busy || checking} onClick={onRefresh}>{busy || checking ? 'Checking verification…' : 'I have verified my email'}</button><button className="secondary-button full" disabled={busy || resending} onClick={handleResend}>{resending ? 'Sending…' : 'Resend verification email'}</button><button className="text-button" disabled={busy || resending} onClick={onSignOut}>Sign out</button><div className="auth-note"><ShieldCheck size={16} /><span>Check your spam or junk folder if the message is missing. Verified email is required before Tridash can open protected ride and safety data.</span></div></div></div>;
}

function PassengerWorkspace(props: any) {
  const navigate = useNavigate();
  const location = useLocation();
  const { tab, setTab, profile, activeRide, myTrips, requestRide, updateRide, cancelRide, sendSOS, shareTrip, payRide, paymentBusy, saveProfile, profileBusy, notify, showRating, setShowRating, rating, setRating, review, setReview, submitRating, notificationsEnabled, enableNotifications, selectedRide, setSelectedRide, driverLocation } = props;
  if (tab === 'request') return <RequestPageMap requestRide={requestRide} setTab={setTab} notify={notify} profile={profile} />;
  if (selectedRide) return <RideDetail ride={selectedRide} setSelectedRide={setSelectedRide} payRide={payRide} paymentBusy={paymentBusy} driverLocation={driverLocation} cancelRide={cancelRide} />;
  if (tab === 'trips') return <TripsPage trips={myTrips} setTab={setTab} setSelectedRide={(ride: Ride) => { setSelectedRide(ride); }} />;
  if (tab === 'safety') return <SafetyPage activeRide={activeRide} profile={profile} sendSOS={sendSOS} shareTrip={shareTrip} setTab={setTab} notify={notify} />;
  if (tab === 'profile') return <ProfilePage profile={profile} saveProfile={saveProfile} profileBusy={profileBusy} notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} setTab={setTab} />;
  return (
    <div className="mobile-frame">
      <section className="hero-copy"><div className="eyebrow">PASSENGER</div><h1>Good morning,<br /><strong>{profile.name || 'there'} 👋</strong></h1><p>Every ride, logged. Every driver, checked.</p></section>
      {activeRide ? <ActiveRideCard ride={activeRide} driverLocation={driverLocation} onClick={() => { setSelectedRide(activeRide); navigateFromRoot(navigate, location.pathname, 'trips/' + encodeURIComponent(activeRide.id) + '?from=home'); }} /> :
        <section className="empty-card"><div className="empty-icon"><CarFront size={23} /></div><h2>No active ride</h2><p>Request a verified tricycle when you are ready to go.</p><button className="primary-button" onClick={() => setTab('request')}>Request a ride <ChevronRight size={18} /></button></section>}
      <section className="feature-grid"><Feature icon={<ShieldCheck />} title="ID checked" text="Drivers are verified before the first ride." /><Feature icon={<ShieldAlert />} title="SOS on every trip" text="Safety tools stay one tap away." /></section>
      <section className="feature-grid"><Feature icon={<Navigation />} title="Trip sharing" text="Share your current journey with someone you trust." /><Feature icon={<CreditCard />} title="Simple payments" text="Track payment status and method per trip." /></section>
      <BottomNav tab={tab} setTab={setTab} />
      {showRating && <RatingModal rating={rating} setRating={setRating} review={review} setReview={setReview} submit={submitRating} close={() => setShowRating(false)} />}
    </div>
  );
}

function RequestPage({ requestRide, setTab }: any) {
  const [pickup, setPickup] = useState('Current location');
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState(2000);
  return <div className="mobile-frame">
    <section className="screen-head"><button className="back-button" onClick={() => setTab('home')}>←</button><div><div className="eyebrow">NEW RIDE</div><h2>Request a ride</h2></div></section>
    <div className="map-card"><div className="map-grid"><span className="map-pin pickup"><MapPin size={21} /></span><span className="map-pin destination"><MapPin size={21} /></span><div className="route-line" /></div><div className="map-caption"><span>{pickup}</span><span>{destination || 'Destination'}</span></div></div>
    <div className="form-card">
      <label>Pickup location<input value={pickup} onChange={e => setPickup(e.target.value)} placeholder="Enter pickup point" /></label>
      <label>Destination<input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Where are you going?" /></label>
      <label>Estimated fare<input type="number" min="0" value={amount} onChange={e => setAmount(Number(e.target.value))} /></label>
      <p className="hint">Fare can be confirmed with the driver before the trip starts.</p>
      <button className="primary-button full" disabled={!destination.trim()} onClick={() => requestRide(pickup, destination.trim(), amount)}>Confirm ride <ChevronRight size={18} /></button>
    </div>
  </div>;
}

function ActiveRideCard({ ride, driverLocation, onClick }: any) {
  return <section className="ride-card ride-card-map">
    <div className="card-top"><div><span className="eyebrow">CURRENT TRIP</span><strong className="ride-card-heading">{ride.status === 'Requested' ? 'Finding your driver' : ride.driver ? 'Driver assigned' : 'Ride in progress'}</strong></div><span className={'ride-status ' + ride.status.toLowerCase().replaceAll(' ', '-')}>{ride.status}</span></div>
    <button className="ride-route-action" onClick={onClick} aria-label="Open current trip details"><div className="route"><RoutePoint label="FROM" value={ride.pickup} /><RoutePoint label="TO" value={ride.destination} destination /></div></button>
    <MapView pickup={ride.pickupCoords} destination={ride.destinationCoords} driverLocation={driverLocation} followDriver={ride.status === 'In Progress'} />
    <div className="ride-card-meta"><span><ShieldCheck size={15} /> {ride.driver ? 'Verified driver' : 'Matching with a verified driver'}</span><strong>₦{ride.amount.toLocaleString()}</strong></div>
    <button className="primary-button full ride-view-button" onClick={onClick}>View trip details <ChevronRight size={17} /></button>
  </section>;
}
function RoutePoint({ label, value, destination }: any) { return <div className="route-point"><span className={'dot ' + (destination ? 'destination-dot' : '')} /><div><small>{label}</small><strong>{value}</strong></div></div>; }
function Feature({ icon, title, text }: any) { return <div className="feature-card"><div className="feature-icon">{icon}</div><strong>{title}</strong><p>{text}</p></div>; }

function RideDetail({ ride, setSelectedRide, payRide, paymentBusy, driverLocation, cancelRide, backTarget = 'trips' }: any) {
  const navigate = useNavigate();
  const detailLocation = useLocation();
  const fromHome = new URLSearchParams(detailLocation.search).get('from') === 'home';
  return <div className="mobile-frame">
    <section className="screen-head"><button className="back-button" onClick={() => navigateFromRoot(navigate, detailLocation.pathname, fromHome ? '' : backTarget)}>←</button><div><div className="eyebrow">TRIP DETAILS</div><h2>{ride.status}</h2></div></section>
    <MapView pickup={ride.pickupCoords} destination={ride.destinationCoords} driverLocation={driverLocation} followDriver={ride.status === 'In Progress'} />
    <div className="driver-card"><div className="avatar">{(ride.driver || 'DR').split(' ').map((x: string) => x[0]).join('')}</div><div className="driver-info"><strong>{ride.driver || 'Driver search in progress'}</strong><span>{ride.tricycle || 'Tricycle pending'} · <Star size={13} fill="currentColor" /> {ride.rating || '—'}</span>{ride.driverPhone && <small>{ride.driverPhone}</small>}</div>{ride.driver && <>{ride.driverPhone ? <a className="call-button" href={'tel:' + ride.driverPhone} aria-label={'Call ' + ride.driver}><Phone size={17} /></a> : <span className="hint">Driver phone unavailable</span>}<span className="verified"><ShieldCheck size={14} /> Verified</span></>}</div>
    <div className="trip-details"><div><span>FROM</span><strong>{ride.pickup}</strong></div><div><span>TO</span><strong>{ride.destination}</strong></div></div>{ride.riderPhone && <div className="trip-details"><div><span>RIDER</span><strong>{ride.riderName || ride.passenger}</strong></div><div><span>CONTACT</span><strong>{ride.riderPhone}</strong></div></div>}
    <div className="payment-box"><div><span>FARE</span><strong>₦{ride.amount.toLocaleString()}</strong></div><div><span>PAYMENT</span><strong>{ride.paymentStatus || 'Pending'}</strong></div></div>
    {ride.status !== 'Completed' && ride.status !== 'Cancelled' && cancelRide && <div className="payment-actions"><button className="secondary-button danger-button full" onClick={() => cancelRide(ride)}>Cancel ride</button></div>}
    {ride.status === 'Completed' && ride.paymentStatus !== 'Paid' && <div className="payment-actions"><button className="primary-button" disabled={paymentBusy} onClick={() => payRide(ride)}>{paymentBusy ? 'Opening secure checkout…' : 'Pay online with Paystack'}</button></div>}
    {ride.status === 'Completed' && ride.paymentStatus !== 'Paid' && <p className="hint">Online payment is securely processed by Paystack. Tridash verifies the transaction and exact fare before marking the ride paid.</p>}
  </div>;
}

function TripsPage({ trips, setTab, setSelectedRide, workspace = 'rider' }: any) {
  const navigate = useNavigate();
  const location = useLocation();
  const tripDetailTarget = workspace === 'driver' ? 'driver/trips/' : 'trips/';
  const backTarget = workspace === 'driver' ? 'driver' : '';
  const openTrip = (ride: Ride) => { setSelectedRide(ride); navigateFromRoot(navigate, location.pathname, tripDetailTarget + encodeURIComponent(ride.id)); };
  return <div className="mobile-frame"><section className="screen-head"><button className="back-button" onClick={() => navigateFromRoot(navigate, location.pathname, backTarget)}>←</button><div><div className="eyebrow">YOUR RIDES</div><h2>Trip history</h2></div></section>{trips.length ? trips.map((ride: Ride) => <button className="history-item" key={ride.id} onClick={() => openTrip(ride)}><div className="history-icon"><CarFront size={18} /></div><div><strong>{ride.destination}</strong><span>{ride.driver || 'Driver pending'} · {ride.status}</span></div><b>₦{ride.amount.toLocaleString()}</b></button>) : <div className="empty-card"><div className="empty-icon"><History size={22} /></div><h2>No trips yet</h2><p>Your completed and cancelled trips will appear here.</p></div>}</div>;
}

function SafetyPage({ activeRide, profile, sendSOS, shareTrip, setTab, notify }: any) {
  return <div className="mobile-frame"><section className="screen-head"><button className="back-button" onClick={() => setTab('home')}>←</button><div><div className="eyebrow">SAFETY CENTRE</div><h2>Ride with confidence</h2></div></section>
    <div className="safety-hero"><ShieldAlert size={30} /><strong>SOS on every trip</strong><p>Use SOS when you need urgent assistance. Tridash records the incident with your trip reference.</p><button className="sos-large" disabled={!activeRide} onClick={sendSOS}><AlertTriangle size={21} /> {activeRide ? 'ACTIVATE SOS' : 'NO ACTIVE TRIP'}</button></div>
    <div className="safety-list"><div><ShieldCheck size={20} /><span><strong>Verified drivers</strong><small>Government ID and tricycle registration checks are recorded.</small></span></div><div><Users size={20} /><span><strong>Emergency contact</strong><small>{profile.emergencyName ? profile.emergencyName + ' · ' + profile.emergencyPhone : 'Add an emergency contact in Profile.'}</small></span></div><div><Navigation size={20} /><span><strong>Share trip</strong><small>Send route and status to someone you trust.</small></span><button className="secondary-button" disabled={!activeRide} onClick={shareTrip}>Share</button></div></div>
    <IncidentReportButton activeRide={activeRide} notify={notify} />
  </div>;
}

function ProfilePage({ profile, saveProfile, profileBusy, notificationsEnabled, enableNotifications, setTab }: any) {
  const [form, setForm] = useState(profile);
  return <div className="mobile-frame"><section className="screen-head"><button className="back-button" onClick={() => setTab('home')}>←</button><div><div className="eyebrow">ACCOUNT</div><h2>Profile & settings</h2></div></section>
    <div className="profile-card"><div className="avatar large">{form.name.slice(0,2).toUpperCase() || 'TR'}</div><div><strong>{form.name || 'Your profile'}</strong><span>{form.phone || 'Add your phone number'}</span></div></div>
    <div className="form-card"><label>Full name<input value={form.name} onChange={e => setForm({...form,name:e.target.value})} /></label><label>Phone<input value={form.phone} onChange={e => setForm({...form,phone:e.target.value})} placeholder="080..." /></label><label>Emergency contact name<input value={form.emergencyName} onChange={e => setForm({...form,emergencyName:e.target.value})} /></label><label>Emergency contact phone<input value={form.emergencyPhone} onChange={e => setForm({...form,emergencyPhone:e.target.value})} placeholder="080..." /></label><button className="primary-button full" disabled={profileBusy} aria-busy={profileBusy} onClick={() => saveProfile(form)}>{profileBusy ? 'Saving profile…' : 'Save profile'}</button></div>
    <div className="settings-row"><Bell size={19} /><div><strong>Push notifications</strong><span>{notificationsEnabled ? 'Enabled' : 'Receive ride and safety updates'}</span></div><button className="secondary-button" onClick={enableNotifications}>{notificationsEnabled ? 'Enabled' : 'Enable'}</button></div>
  </div>;
}

function IncidentReportButton({ activeRide, notify }: any) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const submit = async () => {
    if (!activeRide) return;
    if (message.trim().length < 5) return notify('Describe the issue in a little more detail.');
    try {
      await api.post('/api/incidents', { rideId: activeRide.id, type: 'complaint', severity: 'normal', message: message.trim() });
      setMessage('');
      setOpen(false);
      notify('Report submitted to Tridash operations');
    } catch {
      notify('Report could not be submitted');
    }
  };
  return <><button className="secondary-button full" onClick={() => setOpen(true)} disabled={!activeRide}>Report an issue</button>{open && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="incident-title"><button className="modal-close" aria-label="Close report" onClick={() => setOpen(false)}><X /></button><div className="eyebrow">SAFETY REPORT</div><h2 id="incident-title">Report an issue</h2><p>Tell Tridash operations what happened on this trip.</p><textarea autoFocus value={message} onChange={event => setMessage(event.target.value)} placeholder="Describe the issue…" /><div className="confirm-actions"><button className="secondary-button" onClick={() => setOpen(false)}>Cancel</button><button className="primary-button" onClick={submit}>Submit report</button></div></div></div>}</>;
}

function RatingModal({ rating, setRating, review, setReview, submit, close }: any) {
  return <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={close}><X /></button><div className="eyebrow">TRIP COMPLETED</div><h2>How was your trip?</h2><p>Rate your driver and leave a short review.</p><div className="stars">{[1,2,3,4,5].map(n => <button key={n} onClick={() => setRating(n)} className={n <= rating ? 'star-on' : ''}><Star fill="currentColor" /></button>)}</div><textarea value={review} onChange={e => setReview(e.target.value)} placeholder="Tell us about your trip (optional)" /><button className="primary-button full" onClick={submit}>Submit rating</button></div></div>;
}

function DriverWorkspace({ tab, setTab, driver, requests, activeRide, rides, updateRide, acceptRide, rejectRide, toggleOnline, notify, saveProfile, profile, driverLocation }: any) {
  const navigate = useNavigate();
  const location = useLocation();
  if (tab === 'requests') return <DriverRequests requests={requests} driver={driver} acceptRide={acceptRide} rejectRide={rejectRide} setTab={setTab} toggleOnline={toggleOnline} />;
  if (tab === 'trips') return <TripsPage trips={rides.filter((r: Ride) => r.driver === driver.name)} setTab={setTab} workspace="driver" />;
  if (tab === 'profile') return <DriverProfilePage profile={{...profile, role:'driver'}} driver={driver} saveProfile={saveProfile} notify={notify} setTab={setTab} />;
  return <div className="mobile-frame"><section className="hero-copy"><div className="eyebrow">DRIVER</div><h1>Good morning,<br /><strong>{driver.name.split(' ')[0]} 👋</strong></h1><p>Verified drivers keep every ride accountable.</p></section><div className="online-card"><div><span className={'status-dot ' + (driver.online ? '' : 'offline')} /> {driver.online ? 'Online' : 'Offline'}</div><button onClick={toggleOnline}>{driver.online ? 'Go offline' : 'Go online'}</button></div><div className="verification-card"><div className="verified-badge"><ShieldCheck size={19} /></div><div><span className="eyebrow">VERIFICATION</span><strong>{driver.verified ? 'Verified driver' : 'Verification pending'}</strong><p>Government ID and tricycle registration status is stored on your driver record.</p></div></div>{activeRide && activeRide.driver === driver.name ? <ActiveDriverRide ride={activeRide} updateRide={updateRide} notify={notify} driverLocation={driverLocation} /> : <div className="empty-card"><div className="empty-icon"><CarFront size={22} /></div><h2>{driver.online ? 'Waiting for requests' : 'You are offline'}</h2><p>{driver.online ? 'New passenger requests will appear in Ride requests.' : 'Go online to receive ride requests.'}</p><button className="primary-button" onClick={() => setTab('requests')}>View requests <ChevronRight size={18} /></button></div>}<BottomNav tab={tab} setTab={setTab} driver /></div>;
}

function DriverRequests({ requests, driver, acceptRide, rejectRide, setTab, toggleOnline }: any) {
  const canManage = !!driver?.verified && !!driver?.online;
  const visibleRequests = requests.filter((ride: Ride) => !(ride.rejectedByDriverIds || []).includes(driver?.userId) && !(ride.rejectedByDriverIds || []).includes(driver?.id));
  return <div className="mobile-frame"><section className="screen-head"><button className="back-button" onClick={() => setTab('home')}>←</button><div><div className="eyebrow">RIDE REQUESTS</div><h2>Available trips</h2></div></section><div className="driver-availability-card"><div><strong>{driver?.online ? 'You are online' : 'You are offline'}</strong><span>{driver?.verified ? (driver?.online ? 'Passenger requests can be accepted or declined.' : 'Go online to manage requests.') : 'Your driver account must be verified before you can manage requests.'}</span></div>{driver?.verified && <button onClick={toggleOnline}>{driver?.online ? 'Go offline' : 'Go online'}</button>}</div>{visibleRequests.length ? visibleRequests.map((ride: Ride) => <div className="request-card" key={ride.id}><div><span className="eyebrow">PICKUP</span><strong>{ride.pickup}</strong><span className="destination-line">→ {ride.destination}</span><span className="request-meta"><MapPin size={13} /> Passenger {ride.passenger}</span></div><div className="request-actions"><div><b>₦{ride.amount.toLocaleString()}</b><div className="request-readiness">{!driver?.verified ? 'Awaiting verification' : !driver?.online ? 'Go online to manage' : 'Ready'}</div></div><div className="request-action-buttons"><button className="secondary-button compact" disabled={!canManage} onClick={() => rejectRide(ride)}>Reject</button><button className="primary-button" disabled={!canManage} onClick={async () => { const accepted = await acceptRide(ride); if (accepted) setTab('home'); }}>Accept</button></div></div></div>) : <div className="empty-card"><div className="empty-icon"><Clock3 size={22} /></div><h2>No requests yet</h2><p>Stay online to receive nearby passenger requests.</p></div>}</div>;
}

function DriverProfilePage({ profile, driver, saveProfile, notify, setTab }: any) {
  const [form, setForm] = useState({ ...profile, tricycle: driver.tricycle || '', governmentId: driver.documents?.includes('Government ID') ? 'Submitted' : '', registration: driver.documents?.includes('Tricycle registration') ? 'Submitted' : '' });
  const submit = async () => {
    await saveProfile({ ...profile, name: form.name, phone: form.phone, emergencyName: form.emergencyName, emergencyPhone: form.emergencyPhone, role: 'driver' });
    try {
      const documents = [form.governmentId.trim() ? 'Government ID' : '', form.registration.trim() ? 'Tricycle registration' : ''].filter(Boolean);
      const res = await api.put('/api/driver/me', { name: form.name, phone: form.phone, tricycle: form.tricycle.trim(), documents });
      if (res.data?.driver) notify(res.data.driver.verified ? 'Driver profile updated' : 'Driver profile submitted for verification');
    } catch { notify('Driver profile could not be saved.'); }
  };
  return <div className="mobile-frame"><section className="screen-head"><button className="back-button" onClick={() => setTab('home')}>←</button><div><div className="eyebrow">DRIVER ONBOARDING</div><h2>Driver profile</h2></div></section><div className="form-card"><label>Full name<input value={form.name} onChange={e => setForm({...form,name:e.target.value})} /></label><label>Phone<input value={form.phone} onChange={e => setForm({...form,phone:e.target.value})} placeholder="080..." /></label><label>Tricycle registration<input value={form.tricycle} onChange={e => setForm({...form,tricycle:e.target.value.toUpperCase()})} placeholder="EB-123-XY" /></label><label>Government ID<input value={form.governmentId} onChange={e => setForm({...form,governmentId:e.target.value})} placeholder="ID number or submitted" /></label><label>Registration document<input value={form.registration} onChange={e => setForm({...form,registration:e.target.value})} placeholder="Registration number or submitted" /></label><button className="primary-button full" onClick={submit}>Save & submit for verification</button></div><div className="verification-card"><div className="verified-badge"><ShieldCheck size={19} /></div><div><span className="eyebrow">STATUS</span><strong>{driver.verified ? 'Verified driver' : 'Pending admin verification'}</strong><p>{driver.verified ? 'You can go online and accept passenger requests.' : 'An administrator must verify your government ID and tricycle registration before you can accept rides.'}</p></div></div></div>;
}

function ActiveDriverRide({ ride, updateRide, notify, driverLocation }: any) {
  return <div className="driver-active"><div className="status-card"><div className="status-icon"><Navigation size={24} /></div><div><strong>{ride.status}</strong><p>{ride.pickup} → {ride.destination}</p></div></div><MapView pickup={ride.pickupCoords} destination={ride.destinationCoords} userLocation={driverLocation} driverLocation={driverLocation} followDriver /><div className="passenger-card"><div className="avatar">{String(ride.passenger || 'PA').slice(0,2).toUpperCase()}</div><div><strong>{ride.passenger}</strong><span>Passenger · emergency support available</span></div>{ride.passengerPhone ? <a className="call-button" href={'tel:' + ride.passengerPhone} aria-label={'Call ' + ride.passenger}><Phone size={17} /></a> : <button className="call-button" aria-label="Passenger phone unavailable" onClick={() => notify('Passenger phone number is not available')}><Phone size={17} /></button>}</div><div className="safety-row"><button onClick={() => notify('Passenger safety contact opened')}><ShieldAlert size={18} /> Safety</button><button onClick={() => notify('Navigation opened for this trip')}><Navigation size={18} /> Navigate</button></div>{ride.status === 'Accepted' && <button className="primary-button full" onClick={() => updateRide(ride,'In Progress',ride.driver || undefined,ride.driverId)}>Start trip</button>}{ride.status === 'In Progress' && <button className="primary-button full" onClick={() => updateRide(ride,'Completed',ride.driver || undefined,ride.driverId)}>Complete trip</button>}</div>;
}

function AdminWorkspace({ drivers, rides, pendingDrivers, approveDriver, notify, updateUserRole, suspendUser, askConfirm, initialSection = 'overview' }: any) {
  const navigate = useNavigate();
  const location = useLocation();
  const [section, setSection] = useState(initialSection);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  const changeSection = (next: string) => {
    setSection(next);
    navigateFromRoot(navigate, location.pathname, next === 'overview' ? 'admin' : 'admin/' + next);
  };
  const [search, setSearch] = useState('');
  const [reportText, setReportText] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const filteredRides = rides.filter((r: Ride) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()));
  const active = rides.filter((r: Ride) => !['Completed','Cancelled'].includes(r.status)).length;
  const passengerCount = users.filter(u => u.role === 'passenger').length;
  const loadAdminData = async () => {
    setAdminLoading(true);
    try {
      const [u, i, p] = await Promise.all([api.get('/api/admin/users'), api.get('/api/admin/incidents'), api.get('/api/admin/payments')]);
      setUsers(u.data?.users || []);
      setIncidents(i.data?.incidents || []);
      setPayments(p.data?.payments || []);
    } catch {
      notify('Some admin data could not be refreshed.');
    } finally {
      setAdminLoading(false);
    }
  };
  useEffect(() => { void loadAdminData(); }, [section]);
  return <div className="admin-layout"><aside className="admin-side"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><div className="eyebrow">OPERATIONS</div>{[['overview',Home,'Overview'],['users',Users,'Users'],['drivers',ShieldCheck,'Drivers'],['rides',Activity,'Rides'],['reports',MessageSquareWarning,'Reports'],['payments',CreditCard,'Payments'],['settings',Settings,'Settings']].map(([key,Icon,label]: any)=><button key={key} className={section===key?'side-active':''} onClick={()=>changeSection(key)}><Icon size={17} />{label}</button>)}</aside><section className="admin-content"><div className="admin-mobile-nav"><select aria-label="Admin section" value={section} onChange={e=>changeSection(e.target.value)}>{[['overview','Overview'],['users','Users'],['drivers','Drivers'],['rides','Rides'],['reports','Reports'],['payments','Payments'],['settings','Settings']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div><div className="admin-head"><div><div className="eyebrow">ADMINISTRATOR</div><h1>{section[0].toUpperCase()+section.slice(1)}</h1></div><button className="secondary-button" disabled={adminLoading} onClick={()=>{ void loadAdminData(); }}>{adminLoading ? 'Refreshing…' : 'Refresh'}</button></div>
    {section==='overview' && <><div className="stats"><Stat label="Passengers" value={passengerCount} icon={Users}/><Stat label="Verified drivers" value={drivers.filter((d: Driver)=>d.verified).length} icon={ShieldCheck}/><Stat label="Active rides" value={active} icon={Activity}/><Stat label="Reports" value={incidents.length} icon={AlertTriangle}/></div><Panel title="Driver verification" eyebrow="PENDING APPLICATIONS"><p className="muted">{pendingDrivers.length ? 'Review submitted government ID and tricycle registration records.' : 'No pending applications.'}</p>{pendingDrivers.map((d: Driver)=><DriverAdminRow key={d.id} driver={d} approve={()=>approveDriver(d)}/>)}</Panel><Panel title="Live ride monitor" eyebrow="CURRENT ACTIVITY">{rides.slice(0,8).map((r: Ride)=><RideAdminRow key={r.id} ride={r}/>)}</Panel></>}
    {section==='users' && <Panel title="User management" eyebrow="PASSENGERS · DRIVERS · ADMINS"><div className="search-box"><Search size={17}/><input placeholder="Search users" value={search} onChange={e=>setSearch(e.target.value)}/></div>{adminLoading ? <p className="muted">Loading users…</p> : users.filter(u=>JSON.stringify(u).toLowerCase().includes(search.toLowerCase())).map(u=><AdminUserRow key={u.id} user={u} updateUserRole={updateUserRole} suspendUser={suspendUser} setUsers={setUsers} askConfirm={askConfirm}/>)}</Panel>}
    {section==='drivers' && <Panel title="Driver management" eyebrow="ALL DRIVERS"><div className="search-box"><Search size={17}/><input placeholder="Search drivers" value={search} onChange={e=>setSearch(e.target.value)}/></div>{drivers.filter((d: Driver)=>d.name.toLowerCase().includes(search.toLowerCase())).map((d: Driver)=><DriverAdminRow key={d.id} driver={d} approve={()=>approveDriver(d)}/>)}</Panel>}
    {section==='rides' && <Panel title="Ride management" eyebrow="ALL RIDES"><div className="search-box"><Search size={17}/><input placeholder="Search passenger, route or status" value={search} onChange={e=>setSearch(e.target.value)}/></div>{filteredRides.map((r: Ride)=><RideAdminRow key={r.id} ride={r}/>)}</Panel>}
    {section==='reports' && <Panel title="Complaints & incidents" eyebrow="SAFETY QUEUE"><div className="incident-demo"><AlertTriangle size={20}/><div><strong>Safety queue</strong><p>Review SOS events, complaints and operational reports.</p></div></div><textarea value={reportText} onChange={e=>setReportText(e.target.value)} placeholder="Incident details…" /><button className="primary-button" disabled={!reportText.trim() || adminLoading} onClick={async()=>{if(!reportText.trim())return;try{await api.post('/api/incidents',{type:'admin-report',message:reportText.trim()});setReportText('');await loadAdminData();notify('Incident recorded')}catch{notify('Incident could not be recorded')}}}>Record incident</button>{adminLoading?<p className="muted">Loading incidents…</p>:incidents.map(i=><div className="ride-row" key={i.id}><div><strong>{i.type||'Incident'}</strong><span>{i.message||'No details'} · {i.createdAt ? new Date(i.createdAt).toLocaleString() : ''}</span></div><span className={'ride-status '+String(i.severity||'normal').toLowerCase()}>{i.severity||'normal'}</span></div>)}</Panel>}
    {section==='payments' && <Panel title="Payment records" eyebrow="FINANCIAL AUDIT"><p className="muted">All Tridash passenger payments are processed online through Paystack and verified server-side before a ride is marked paid.</p>{adminLoading?<p className="muted">Loading payments…</p>:payments.map(p=><div className="ride-row" key={p.id}><div><strong>{p.method||'Payment'}</strong><span>Ride {p.rideId||'—'} · ₦{Number(p.amount||0).toLocaleString()}</span></div><span className={'ride-status '+String(p.status||'Pending').toLowerCase()}>{p.status||'Pending'}</span></div>)}</Panel>}
    {section==='settings' && <Panel title="Platform settings" eyebrow="CONFIGURATION"><div className="settings-row"><Shield size={19}/><div><strong>Safety policy</strong><span>SOS events are stored against trip records.</span></div><CheckCircle2 size={18}/></div><div className="settings-row"><CreditCard size={19}/><div><strong>Payments</strong><span>All passenger payments use Paystack online checkout and server-side verification.</span></div><CheckCircle2 size={18}/></div><div className="settings-row"><Bell size={19}/><div><strong>Notifications</strong><span>Ride and safety notification delivery is enabled through the platform.</span></div><CheckCircle2 size={18}/></div><div className="danger-panel"><div><strong>Start fresh</strong><span>Delete every Tridash and Firebase account except the superadmin account. This is irreversible.</span></div><button className="secondary-button danger-button" onClick={async()=>{const first=await askConfirm('Delete other users?','This will delete every Tridash and Firebase account except the protected superadmin account.','Delete accounts');if(!first)return;const second=await askConfirm('Final confirmation','This action cannot be undone. Continue deleting the other accounts?','Yes, delete them');if(!second)return;try{const res=await api.post('/api/admin/reset-users');notify((res.data?.deletedFirebaseUsers||0)+' other user account(s) deleted.');setUsers([]);}catch(error:any){notify(error?.message||'User reset could not be completed.');}}}>Delete other users</button></div></Panel>}
  </section></div>;
}
function Stat({label,value,icon:Icon}:any){return <div className="stat-card"><Icon size={19}/><span>{label}</span><strong>{value}</strong></div>}
function Panel({title,eyebrow,children}:any){return <section className="admin-panel"><div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>{children}</section>}
function AdminUserRow({user,updateUserRole,suspendUser,setUsers,askConfirm}:any){const suspended=user.status==='suspended';const [saving,setSaving]=useState(false);const changeRole=async(nextRole:Role)=>{if(nextRole===user.role)return;const confirmed=await askConfirm('Change account role?','Change '+(user.name||user.email)+' to '+nextRole+'? This changes the workspace permissions available to the account.','Change role');if(!confirmed)return;setSaving(true);if(await updateUserRole(user.id,nextRole))setUsers((x:any[])=>x.map(item=>item.id===user.id?{...item,role:nextRole}:item));setSaving(false)};const toggleStatus=async()=>{const nextSuspended=!suspended;if(nextSuspended){const confirmed=await askConfirm('Suspend account?','Suspend '+(user.name||user.email)+'? They will be blocked from protected Tridash actions.','Suspend account');if(!confirmed)return;}setSaving(true);if(await suspendUser(user.id,nextSuspended))setUsers((x:any[])=>x.map(item=>item.id===user.id?{...item,status:nextSuspended?'suspended':'active'}:item));setSaving(false)};return <div className="driver-row user-admin-row"><div className="avatar">{String(user.name||user.email).slice(0,2).toUpperCase()}</div><div className="driver-info"><strong>{user.name||'Unnamed user'}</strong><span>{user.email}</span><small className={'user-account-state '+(suspended?'is-suspended':'')}>{suspended?'Suspended account':user.emailVerified?'Verified account':'Email not verified'}</small></div>{!user.isSuperAdmin&&<div className="user-controls"><div className="user-control"><label>Role</label><select disabled={saving} value={user.role} onChange={e=>changeRole(e.target.value as Role)}><option value="passenger">Passenger</option><option value="driver">Driver</option><option value="admin">Admin</option></select></div><div className="user-control"><label>Account</label><button className={'secondary-button compact user-status-button '+(suspended?'reactivate':'suspend')} disabled={saving} onClick={toggleStatus}>{saving?'Saving…':suspended?'Reactivate':'Suspend'}</button></div></div>}{user.isSuperAdmin&&<span className="superadmin-badge">Superadmin protected</span>}</div>}
function DriverAdminRow({driver,approve}:any){return <div className="driver-row"><div className="avatar">{driver.name.split(' ').map((n:string)=>n[0]).join('')}</div><div className="driver-info"><strong>{driver.name}</strong><span>{driver.phone} · {driver.tricycle}</span></div><div className="doc-status"><FileCheck2 size={15}/> {driver.verified?'Verified':'Documents submitted'}</div>{!driver.verified&&<button className="primary-button compact" onClick={approve}>Approve</button>}</div>}
function RideAdminRow({ride}:any){return <div className="ride-row"><div><strong>{ride.passenger}</strong><span>{ride.pickup} → {ride.destination}</span></div><span className={'ride-status '+ride.status.toLowerCase().replaceAll(' ','-')}>{ride.status}</span></div>}

function BottomNav({tab,setTab,driver=false}:any){return <nav className={'bottom-nav ' + (driver ? 'driver-bottom-nav' : '')}><button className={tab==='home'?'nav-active':''} onClick={()=>setTab('home')}><Home size={19}/><span>Home</span></button><button className={tab==='requests'||tab==='trips'?'nav-active':''} onClick={()=>setTab(driver?'requests':'trips')}><Activity size={19}/><span>{driver?'Requests':'Trips'}</span></button>{!driver&&<button className="ride-action" onClick={()=>setTab('request')}><CarFront size={20}/></button>}<button className={tab==='safety'?'nav-active':''} onClick={()=>setTab(driver?'trips':'safety')}><ShieldAlert size={19}/><span>{driver?'History':'Safety'}</span></button><button className={tab==='profile'?'nav-active':''} onClick={()=>setTab('profile')}><UserRound size={19}/><span>Profile</span></button></nav>}

export default App;
