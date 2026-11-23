import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from './api/client';
import { ws } from './api/websocket';
import { notifications } from './api/notifications';
import MapView, { reverseGeocode, type GeoPoint } from './MapView';
import RequestPageMap from './RequestPageMap';
import { firebaseAuth, onAuthStateChanged, resendVerification, refreshFirebaseUser, sendResetEmail, signInWithFirebase, signInWithGoogle, signOut, signUpWithFirebase } from './firebase';
import {
    Activity, AlertTriangle, ArrowUp, Bell, CarFront, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3,
    CreditCard, FileCheck2, History, Home, Landmark, LogOut, MapPin, MessageSquareWarning,
    Navigation, Phone, Search, Settings, Shield, ShieldAlert, ShieldCheck, Star, RefreshCw,
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
    driverVehicleMake?: string | null;
    driverVehicleModel?: string | null;
    driverVehicleColor?: string | null;
    requestedAt?: string;
    acceptedAt?: string;
    startedAt?: string;
    completedAt?: string;
    pickupCoords?: { lat: number; lng: number };
    destinationCoords?: { lat: number; lng: number };
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
    firstName?: string;
    lastName?: string;
    otherNames?: string;
    dateOfBirth?: string | null;
    operatingState?: string;
    verificationStatus?: string;
    identityStatus?: string;
    licenseStatus?: string;
    vehicleStatus?: string;
    faceStatus?: string;
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

// All app destinations are absolute paths. Relative navigation based on the
// current pathname breaks when users open nested routes directly or refresh.
const navigateFromRoot = (navigate: ReturnType<typeof useNavigate>, _pathname: string, target: string) => {
    const cleanTarget = target.replace(/^\/+/, '');
    navigate(cleanTarget ? `/${cleanTarget}` : '/', { preventScrollReset: true });
};

const defaultProfile: Profile = {
    name: '',
    phone: '',
    emergencyName: '',
    emergencyPhone: '',
    role: 'passenger'
};

function ScrollToTopButton() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const updateVisibility = () => setVisible(window.scrollY > 320);
        updateVisibility();
        window.addEventListener('scroll', updateVisibility, { passive: true });
        return () => window.removeEventListener('scroll', updateVisibility);
    }, []);

    if (!visible) return null;

    return (
        <button
            type="button"
            className="scroll-to-top"
            aria-label="Scroll to top"
            title="Scroll to top"
            onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
        >
            <ArrowUp size={21} aria-hidden="true" />
        </button>
    );
}

function App() {
    const [role, setRole] = useState<Role>('passenger');
    const [workspaceMode, setWorkspaceMode] = useState<'rider' | 'driver' | 'admin'>(() => {
        const path = window.location.pathname;
        return path.startsWith('/driver') ? 'driver' : path.startsWith('/admin') ? 'admin' : 'rider';
    });
    const location = useLocation();
    const navigate = useNavigate();
    const rootNavigate = (target: string) => navigateFromRoot(navigate, location.pathname, target);
    const setTab = (next: Tab) => {
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
    const [rides, setRides] = useState<Ride[]>([]);
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [driverProfile, setDriverProfile] = useState<Driver | null>(null);
    const [profile, setProfile] = useState<Profile>(defaultProfile);
    const [activeRide, setActiveRide] = useState<Ride | null>(null);
    const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
    const [toast, setToast] = useState('');
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; resolve: (value: boolean) => void } | null>(null);
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
    const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [paymentBusy, setPaymentBusy] = useState(false);
    const [profileBusy, setProfileBusy] = useState(false);

    useEffect(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        const path = location.pathname;
        if (authUser?.role === 'driver' && path.startsWith('/driver')) setWorkspaceMode('driver');
        else if (authUser?.role === 'admin' && path.startsWith('/admin')) setWorkspaceMode('admin');
        else if (path === '/' || ['/request', '/trips', '/safety', '/profile'].includes(path)) setWorkspaceMode('rider');
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
                // Preserve the current route when Firebase restores the session.
                // In particular, '/' is the Rider Workspace home and must remain there
                // for admins who deliberately switched from Admin to Rider Workspace.
                // Redirect drivers from '/' to their dedicated workspace, but do not
                // force admins from '/' to '/admin' on refresh.
                const currentPath = window.location.pathname;
                const atBareRoot = currentPath === '/' || currentPath === '';
                if (atBareRoot && nextRole === 'driver') {
                    navigate('/driver', { replace: true });
                }
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
        } catch { }
    };

    const unreadNotificationCount = notificationItems.filter(item => !item.read).length;

    const markNotificationRead = async (item: any) => {
        if (!item?.id || notificationBusy) return;
        setNotificationBusy(String(item.id));
        try {
            if (!item.read) {
                try { await api.post('/api/notifications/' + item.id + '/read'); } catch { }
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
        try { await api.post('/api/notifications/read-all'); } catch { }
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
                if (mounted && Array.isArray(driversRes.data?.drivers)) setDrivers(driversRes.data.drivers);
                if (mounted && profileRes.data?.profile) {
                    setProfile(profileRes.data.profile);
                    const profileRole = profileRes.data.profile.role as Role | undefined;
                    setRole(authUser.role === 'admin' || authUser.role === 'driver' ? authUser.role : profileRole || authUser.role || 'passenger');
                }
                if (mounted && driverRes.data?.driver) setDriverProfile(driverRes.data.driver);
                if (mounted && Array.isArray(notificationsRes.data?.notifications)) setNotificationItems(notificationsRes.data.notifications);
            } catch (error: any) {
                if (mounted) notify(error?.message || 'We could not load ride data. Please refresh to try again.');
            }
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
        conn.onError(() => { });
        return () => conn.disconnect();
    }, []);

    useEffect(() => {
        if (!authUser?.userId || role !== 'driver' || !activeRide || ['Completed', 'Cancelled'].includes(activeRide.status)) return;
        if (!navigator.geolocation) {
            notify('Live GPS is not available in this browser.');
            return;
        }
        const watch = navigator.geolocation.watchPosition(async position => {
            const currentLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            setDriverLocation(currentLocation);
            try { await api.post('/api/driver/location', { rideId: activeRide.id, ...currentLocation }); } catch { }
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
            // signInWithGoogle returns null when it falls back to a full-page
            // redirect: the page is navigating away, so there is nothing to report.
            if (!firebaseUser) return true;
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

    const requestRide = async (pickup: string, destination: string, amount: number, pickupCoords?: { lat: number; lng: number }, destinationCoords?: { lat: number; lng: number }, rider?: { name: string; phone: string; bookedForSelf: boolean }) => {
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
        } catch (error: any) {
            // The shared API client throws a standard Error containing the API's
            // response message, rather than an Axios-style response object.
            const serverMessage = String(error?.response?.data?.error || error?.message || '').trim();
            notify(serverMessage || 'We could not save the ride request. Please try again.');
            console.error('Create ride request failed:', error);
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
        try {
            const res = await api.put('/api/rides/' + encodeURIComponent(updated.id), { status });
            if (res.data?.ride) {
                setRides(current => current.map(r => r.id === updated.id ? res.data.ride : r));
                setActiveRide(res.data.ride);
                setSelectedRide(res.data.ride);
            }
        } catch {
            // Roll back optimistic UI state when the server rejects a stale or invalid
            // transition, so the screen never claims a trip advanced when it did not.
            setRides(current => current.map(r => r.id === ride.id ? ride : r));
            setActiveRide(ride);
            setSelectedRide(ride);
            notify('We could not save this trip update. Your trip status has been restored. Please refresh and try again.');
            return;
        }
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
            notify(error?.response?.data?.error || error?.message || 'Online payment could not be started.');
        }
    };

    const approveDriver = async (driver: Driver) => {
        try { const res = await api.post('/api/admin/driver-verifications/' + driver.id + '/approve', {}); if (res.data?.driver) setDrivers(current => current.map(d => d.id === driver.id ? res.data.driver : d)); notify(driver.name + ' approved'); } catch (error: any) { notify(error?.message || 'Driver approval could not be saved. Complete all required document checks first.'); }
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

    const renderPassenger = (routeTab: Tab) => <PassengerWorkspace tab={routeTab} setTab={setTab} profile={profile} activeRide={activeForPassenger} myTrips={myTrips} requestRide={requestRide} cancelRide={cancelRide} sendSOS={sendSOS} shareTrip={shareTrip} driverLocation={driverLocation} payRide={payRide} paymentBusy={paymentBusy} saveProfile={saveProfile} profileBusy={profileBusy} notify={notify} showRating={showRating} setShowRating={setShowRating} rating={rating} setRating={setRating} review={review} setReview={setReview} submitRating={submitRating} notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} selectedRide={selectedRide} setSelectedRide={setSelectedRide} />;
    const renderDriver = (routeTab: Tab) => <DriverWorkspace tab={routeTab} setTab={setTab} driver={driverProfile || drivers.find(d => d.userId === authUser?.userId) || { id: 'pending-driver', userId: authUser?.userId, name: profile.name || authUser?.name || 'Driver', phone: profile.phone || '', rating: 0, verified: false, online: false, tricycle: '', documents: [], status: 'pending' }} requests={requests} activeRide={activeRide} rides={rides} updateRide={updateRide} acceptRide={acceptRide} rejectRide={rejectRide} toggleOnline={toggleDriverOnline} notify={notify} saveProfile={saveProfile} profile={profile} driverLocation={driverLocation} setDriverProfile={setDriverProfile} />;

    const publicContentPaths = ['/', '/about', '/how-it-works', '/safety-info', '/drive', '/faq', '/contact', '/privacy', '/terms'];
    const isPublicContentPath = publicContentPaths.includes(location.pathname);
    const isAuthPath = location.pathname === '/login' || location.pathname === '/signup';
    const isSharedTripPath = location.pathname.startsWith('/shared-trip/');
    const isPrivateAppPath = /^\/(request|trips|safety|profile|driver|admin)(\/|$)/.test(location.pathname);
    const deploymentMode = String((import.meta as any).env?.VITE_TRIDASH_DEPLOYMENT || 'combined');
    if (isSharedTripPath) return <Routes><Route path="/shared-trip/:token" element={<SharedTripRoute />} /><Route path="*" element={<NotFoundPage />} /></Routes>;
    // On the root URL, wait for Firebase to restore the session before choosing
    // between the public landing page and the authenticated user's dashboard.
    // This prevents a signed-in user from briefly seeing the public site on refresh.
    if (location.pathname === '/' && !authReady) return <div className="loading-screen"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><p>Checking your secure session…</p></div>;
    if (deploymentMode !== 'app' && isPublicContentPath && (!authUser || location.pathname !== '/')) return <PublicSite />;
    if (!authUser && !isPublicContentPath && !isAuthPath && !isPrivateAppPath) return <NotFoundPage />;
    if (!authReady || (Boolean(authUser) && loading)) return <div className="loading-screen"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><p>Preparing your workspace…</p></div>;
    if (!authUser) return <AuthScreen busy={authBusy} onSignIn={signIn} onSignUp={signUp} onGoogleSignIn={signInGoogle} onResetPassword={resetPassword} />;
    if (!authUser.emailVerified) return <VerificationScreen busy={authBusy} firebaseUser={authUser.firebaseUser} onVerified={async (refreshed: any) => { setAuthBusy(true); try { await syncFirebaseSession(refreshed, authUser.role === 'driver' ? 'driver' : 'passenger'); notify('Email verified. Welcome to Tridash.'); } finally { setAuthBusy(false); } }} onRefresh={async () => { setAuthBusy(true); try { const refreshed = await refreshFirebaseUser(authUser.firebaseUser); if (refreshed?.emailVerified) { await syncFirebaseSession(refreshed, authUser.role === 'driver' ? 'driver' : 'passenger'); notify('Email verified. Welcome to Tridash.'); } else { notify('Your email is not verified yet. Open the verification link, then try again.'); } } catch (error: any) { notify(error?.message || 'We could not refresh your verification status.'); } finally { setAuthBusy(false); } }} onResend={async () => { try { await resendVerification(authUser.firebaseUser); notify('Verification email sent again. Check spam or junk if you do not see it.'); } catch (error: any) { notify(error?.message || 'Unable to resend the verification email.'); } }} onSignOut={async () => { await api.post('/api/auth/logout').catch(() => { }); await signOut(firebaseAuth); setAuthUser(null); setAuthReady(true); }} />;
    if (isAuthPath) return <Navigate replace to={authUser.role === 'admin' ? '/admin' : authUser.role === 'driver' ? '/driver' : '/'} />;


    const switchWorkspace = (next: 'rider' | 'driver' | 'admin') => {
        if (next === 'driver' && role !== 'driver') return;
        if (next === 'admin' && role !== 'admin') return;
        setWorkspaceMode(next);
        setMenuOpen(false);
        setNotificationOpen(false);
        setSelectedRide(null);
        rootNavigate(next === 'driver' ? 'driver' : next === 'admin' ? 'admin' : '');
    };

    const goWorkspaceHome = () => switchWorkspace(workspaceMode);

    return (
        <div className="app-shell">
            <ScrollToTopButton />
            <a className="skip-link" href="#main-content">Skip to main content</a>
            <header className="topbar" ref={topbarRef}>
                <button className="brand" aria-label="Go to workspace home" onClick={goWorkspaceHome}><span className="brand-mark"><Zap size={18} /></span><span>tridash</span></button>
                <div className="topbar-actions">
                    {role !== 'passenger' && <button className="workspace-trigger" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><span className="workspace-trigger-text"><span className="workspace-trigger-label">WORKSPACE</span><strong>{workspaceMode === 'admin' ? 'Admin' : workspaceMode === 'driver' ? 'Driver' : 'Rider'}</strong></span><ChevronDown size={15} /></button>}
                    <div className="notification-wrap">
                        <button className="icon-button notification-button" title="Notifications" aria-label="Notifications" aria-expanded={notificationOpen} onClick={() => { setNotificationOpen(v => !v); setMenuOpen(false); }}><Bell size={18} />{unreadNotificationCount > 0 && <span className="notification-badge">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}</button>
                        {notificationOpen && <div className="notification-popover" role="dialog" aria-label="Notifications">
                            <div className="notification-head"><div><span className="eyebrow">INBOX</span><strong>Notifications</strong></div>{unreadNotificationCount > 0 && <button className="text-button-inline" disabled={notificationBusy !== null} aria-busy={notificationBusy === 'all'} onClick={markAllNotificationsRead}>{notificationBusy === 'all' ? 'Marking…' : 'Mark all read'}</button>}</div>
                            <div className="notification-list">{notificationItems.length ? notificationItems.slice(0, 12).map(item => <button key={item.id} className={'notification-item ' + (item.read ? '' : 'unread')} onClick={() => markNotificationRead(item)}><span className="notification-icon"><Bell size={15} /></span><span className="notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small></span></button>) : <div className="notification-empty"><Bell size={20} /><span>No notifications yet.</span></div>}</div>
                        </div>}
                    </div>
                    <button className="icon-button" title="Sign out" aria-label="Sign out" onClick={async () => { await api.post('/api/auth/logout').catch(() => { }); await signOut(firebaseAuth); setAuthUser(null); setAuthReady(true); setRole('passenger'); setWorkspaceMode('rider'); setSelectedRide(null); navigate('/login', { replace: true }); notify('Signed out'); }}><LogOut size={18} /></button>
                </div>
            </header>
            {role !== 'passenger' && menuOpen && <div className="role-menu" role="menu"><div className="eyebrow">SWITCH WORKSPACE</div>
                <button className={workspaceMode === 'rider' ? 'workspace-option active' : 'workspace-option'} onClick={() => switchWorkspace('rider')}><strong>Rider mode</strong><span>Book and manage rides</span></button>
                {role === 'driver' && <button className={workspaceMode === 'driver' ? 'workspace-option active' : 'workspace-option'} onClick={() => switchWorkspace('driver')}><strong>Driver mode</strong><span>Accept and operate rides</span></button>}
                {role === 'admin' && <button className={workspaceMode === 'admin' ? 'workspace-option active' : 'workspace-option'} onClick={() => switchWorkspace('admin')}><strong>Admin mode</strong><span>Manage Tridash operations</span></button>}
            </div>}
            <main id="main-content" tabIndex={-1}>
                <Routes>
                    <Route path="" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} /> : workspaceMode === 'driver' ? renderDriver('home') : renderPassenger('home')} />
                    <Route path="request" element={renderPassenger('request')} />
                    <Route path="trips" element={renderPassenger('trips')} />
                    <Route path="trips/:rideId" element={<RideRoute rides={rides} setSelectedRide={setSelectedRide} payRide={payRide} paymentBusy={paymentBusy} driverLocation={driverLocation} cancelRide={cancelRide} />} />
                    <Route path="shared-trip/:token" element={<SharedTripRoute />} />
                    <Route path="safety" element={renderPassenger('safety')} />
                    <Route path="profile" element={renderPassenger('profile')} />
                    <Route path="driver" element={authUser?.role === 'driver' ? renderDriver('home') : <Navigate replace to="/" />} />
                    <Route path="driver/requests" element={authUser?.role === 'driver' ? renderDriver('requests') : <Navigate replace to="/" />} />
                    <Route path="driver/trips" element={authUser?.role === 'driver' ? renderDriver('trips') : <Navigate replace to="/" />} />
                    <Route path="driver/trips/:rideId" element={authUser?.role === 'driver' ? <RideRoute rides={rides} setSelectedRide={setSelectedRide} payRide={payRide} paymentBusy={paymentBusy} driverLocation={driverLocation} backTarget="driver/trips" viewAsDriver /> : <Navigate replace to="/" />} />
                    <Route path="driver/profile" element={authUser?.role === 'driver' ? renderDriver('profile') : <Navigate replace to="/" />} />
                    <Route path="admin" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} /> : renderPassenger('home')} />
                    <Route path="admin/users" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="users" /> : renderPassenger('home')} />
                    <Route path="admin/drivers" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="drivers" /> : renderPassenger('home')} />
                    <Route path="admin/rides" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="rides" /> : renderPassenger('home')} />
                    <Route path="admin/reports" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="reports" /> : renderPassenger('home')} />
                    <Route path="admin/payments" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="payments" /> : renderPassenger('home')} />
                    <Route path="admin/settings" element={workspaceMode === 'admin' ? <AdminWorkspace drivers={drivers} rides={rides} pendingDrivers={pendingDrivers} approveDriver={approveDriver} notify={notify} updateUserRole={updateUserRole} suspendUser={suspendUser} askConfirm={askConfirm} initialSection="settings" /> : renderPassenger('home')} />
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
            </main>
            {toast && <div className="toast" role="status" aria-live="polite" aria-atomic="true"><CheckCircle2 size={17} aria-hidden="true" />{toast}</div>}
            {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} onCancel={() => { const resolve = confirmDialog.resolve; setConfirmDialog(null); resolve(false); }} onConfirm={() => { const resolve = confirmDialog.resolve; setConfirmDialog(null); resolve(true); }} />}
        </div>
    );
}

function appHref(path: string) {
    // Keep public-site sign-in and sign-up links pointed at the dedicated app
    // even if the public Render service is missing its optional environment value.
    const appBaseUrl = String(
        (import.meta as any).env?.VITE_TRIDASH_APP_URL || 'https://app-tridash.onrender.com'
    ).replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${appBaseUrl}${cleanPath}`;
}

export function PublicSite() {
    const location = useLocation();
    const path = location.pathname;
    const pages: Record<string, { eyebrow: string; title: string; intro: string }> = {
        '/about': { eyebrow: 'ABOUT TRIDASH', title: 'Local rides, with clarity at every step.', intro: 'Tridash is being built to make booking and managing tricycle rides simpler for passengers and drivers.' },
        '/how-it-works': { eyebrow: 'HOW IT WORKS', title: 'From pickup to arrival, without the guesswork.', intro: 'A straightforward ride flow designed to keep passengers informed and drivers in control.' },
        '/safety-info': { eyebrow: 'SAFETY FIRST', title: 'Safety is part of the ride, not an afterthought.', intro: 'Account controls, driver verification and trip information help make every journey more accountable.' },
        '/drive': { eyebrow: 'DRIVE WITH TRIDASH', title: 'Bring your tricycle. Build your work around the road.', intro: 'Create a driver account, submit your details and documents, and complete review before accepting rides.' },
        '/faq': { eyebrow: 'HELP CENTRE', title: 'Questions before your first ride?', intro: 'Here are answers to common questions about booking, payments, driver registration and safety.' },
        '/contact': { eyebrow: 'CONTACT', title: 'We’re here to help you find the right next step.', intro: 'For account-specific trip support, sign in to access your Tridash workspace and its available support and safety tools.' },
        '/privacy': { eyebrow: 'PRIVACY', title: 'Your information should be handled with care.', intro: 'This page explains the main categories of information the service may need. The final policy must be reviewed and completed before public launch.' },
        '/terms': { eyebrow: 'TERMS OF USE', title: 'Clear expectations make better journeys.', intro: 'These are the core service expectations for passengers and drivers. The final terms should receive legal review before public launch.' }
    };
    const page = pages[path];
    const isHome = path === '/';
    useEffect(() => {
        const title = isHome ? 'Tridash — Local rides, made more straightforward' : `${page?.eyebrow || 'TRIDASH'} | Tridash`;
        document.title = title;
        const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
        if (description) description.content = isHome ? 'Explore Tridash, learn how local tricycle rides work, review safety information, and get started as a passenger or driver.' : (page?.intro || 'Learn more about Tridash local rides.');
    }, [isHome, page?.eyebrow, page?.intro]);
    return <div className="public-site">
        <ScrollToTopButton />
        <a className="skip-link" href="#public-main">Skip to main content</a>
        <header className="public-header">
            <div className="public-header-inner">
                <Link to="/" className="public-brand" aria-label="Tridash home"><span className="public-brand-mark"><Zap size={19} fill="currentColor" aria-hidden="true" /></span><span>tridash</span></Link>
                <nav className="public-nav" aria-label="Main navigation">
                    <Link to="/how-it-works" aria-current={path === '/how-it-works' ? 'page' : undefined}>How it works</Link>
                    <Link to="/safety-info" aria-current={path === '/safety-info' ? 'page' : undefined}>Safety</Link>
                    <Link to="/about" aria-current={path === '/about' ? 'page' : undefined}>About</Link>
                    <Link to="/faq" aria-current={path === '/faq' ? 'page' : undefined}>FAQs</Link>
                    <Link to="/drive" aria-current={path === '/drive' ? 'page' : undefined}>Become a driver</Link>
                </nav>
                <div className="public-header-actions"><a className="public-login" href={appHref('/login')}>Sign in</a><a className="public-button public-button-small" href={appHref('/signup')}>Get started</a></div>
            </div>
        </header>
        <main id="public-main" className="public-main" tabIndex={-1}>
            {isHome ? <>
                <section className="public-hero">
                    <div className="public-hero-copy"><span className="public-kicker"><span className="public-kicker-dot" /> A simpler way to move locally</span><h1>Your city.<br /><span>Your ride. Your way.</span></h1><p>Book local tricycle rides with a clearer journey from pickup to arrival. See your trip details, know when a driver is assigned, and manage your ride in one place.</p><div className="public-hero-actions"><a className="public-button" href={appHref('/signup')}>Book a ride <ChevronRight size={18} aria-hidden="true" /></a><Link className="public-button public-button-outline" to="/drive">Become a driver</Link></div><div className="public-trust-note"><ShieldCheck size={17} aria-hidden="true" /><span>Driver approval is required before drivers can accept rides.</span></div></div>
                    <div className="public-hero-visual" aria-hidden="true"><div className="public-orbit public-orbit-one" /><div className="public-orbit public-orbit-two" /><div className="public-ride-card"><div className="public-ride-card-top"><span className="public-mini-mark"><Zap size={14} aria-hidden="true" /></span><span>YOUR NEXT RIDE</span><span className="public-live-dot" /> </div><div className="public-route-line"><span className="public-route-point" /><div><small>PICKUP</small><strong>Your location</strong></div></div><div className="public-route-line public-route-destination"><span className="public-route-point" /><div><small>DESTINATION</small><strong>Where you’re going</strong></div></div><div className="public-ride-card-bottom"><span><ShieldCheck size={15} aria-hidden="true" /> Ride details in one place</span><CarFront size={25} aria-hidden="true" /></div></div><div className="public-floating-tag public-tag-one"><MapPin size={16} aria-hidden="true" /><span>Choose your pickup</span></div><div className="public-floating-tag public-tag-two"><CheckCircle2 size={16} aria-hidden="true" /><span>Know your driver</span></div></div>
                </section>
                <section className="public-promise-strip" aria-label="Tridash service principles">
                    <div className="public-promise-inner">
                        <div className="public-promise-intro"><span className="public-kicker">THE TRIDASH APPROACH</span><strong>Made for everyday local journeys.</strong></div>
                        <div className="public-promise-item"><span className="public-promise-number">01</span><span><strong>Know the plan</strong><small>Review pickup, destination and fare before requesting.</small></span></div>
                        <div className="public-promise-item"><span className="public-promise-number">02</span><span><strong>Know your driver</strong><small>See assigned driver and vehicle details when available.</small></span></div>
                        <div className="public-promise-item"><span className="public-promise-number">03</span><span><strong>Keep it on record</strong><small>Follow trip status and access your ride history.</small></span></div>
                    </div>
                </section>
                <section className="public-value-section"><div className="public-section-heading"><span className="public-kicker">BUILT AROUND YOUR JOURNEY</span><h2>Less uncertainty. More clarity.</h2><p>The essentials are easy to find before, during and after a ride.</p></div><div className="public-feature-grid"><article className="public-feature-card"><span className="public-feature-icon"><MapPin aria-hidden="true" /></span><h3>Set your trip</h3><p>Enter pickup and destination details before requesting a ride.</p></article><article className="public-feature-card"><span className="public-feature-icon"><ShieldCheck aria-hidden="true" /></span><h3>Driver review</h3><p>Driver onboarding includes identity, licence and vehicle-document review.</p></article><article className="public-feature-card"><span className="public-feature-icon"><CreditCard aria-hidden="true" /></span><h3>Online payments</h3><p>Pay through the supported online payment flow—Tridash does not offer cash rides.</p></article></div></section>
                <section className="public-journey-section">
                    <div className="public-journey-heading"><span className="public-kicker">HOW YOUR RIDE COMES TOGETHER</span><h2>Three steps. One clearer journey.</h2><p>From choosing your route to checking your trip status, the essentials stay easy to follow.</p></div>
                    <div className="public-journey-grid">
                        <article className="public-journey-step"><span className="public-journey-number">01</span><div><MapPin size={22} aria-hidden="true" /><h3>Choose your route</h3><p>Enter your pickup and destination, then review your ride details before requesting.</p></div></article>
                        <article className="public-journey-step"><span className="public-journey-number">02</span><div><ShieldCheck size={22} aria-hidden="true" /><h3>Get driver details</h3><p>Once a verified driver accepts, review the available driver and vehicle information.</p></div></article>
                        <article className="public-journey-step"><span className="public-journey-number">03</span><div><CreditCard size={22} aria-hidden="true" /><h3>Pay online, stay informed</h3><p>Use online payment and follow your trip status from your Tridash workspace.</p></div></article>
                    </div>
                </section>
                <section className="public-driver-cta"><div><span className="public-kicker">FOR DRIVERS</span><h2>Ready to drive with Tridash?</h2><p>Start your driver application and complete the required details and verification steps.</p></div><a className="public-button public-button-light" href={appHref('/signup?role=driver')}>Start driver registration <ChevronRight size={18} aria-hidden="true" /></a></section>
                <section className="public-help-cta" aria-labelledby="public-help-title"><div className="public-help-copy"><span className="public-kicker">BEFORE YOU GET STARTED</span><h2 id="public-help-title">Want to know a little more first?</h2><p>Explore how bookings work, what driver approval means, and the safety information available before your first trip.</p></div><div className="public-help-actions"><Link className="public-button" to="/faq">Read the FAQs <ChevronRight size={17} aria-hidden="true" /></Link><Link className="public-help-text-link" to="/safety-info">Explore safety information <ChevronRight size={16} aria-hidden="true" /></Link></div></section>
            </> : <>
                <section className="public-page-hero"><div className="public-page-hero-inner"><span className="public-kicker">{page?.eyebrow || 'TRIDASH'}</span><h1>{page?.title || 'Welcome to Tridash.'}</h1><p>{page?.intro || 'A clearer way to organise local rides.'}</p>{path === '/drive' && <a className="public-button" href={appHref('/signup?role=driver')}>Create a driver account <ChevronRight size={18} aria-hidden="true" /></a>}{path === '/contact' && <a className="public-button" href={appHref('/login')}>Sign in for account support <ChevronRight size={18} aria-hidden="true" /></a>}</div></section>
                <section className="public-content-section">
                    {path === '/about' && <><h2>What we’re building</h2><p>Tridash is a ride-hailing service designed around local tricycle trips. The goal is to give passengers a clear booking flow and give drivers a dedicated workspace for requests, trips and account verification.</p><h2>Designed for both sides of the trip</h2><p>Passengers can manage ride requests and trip details. Drivers can review requests, manage their availability after approval, and keep track of their rides.</p></>}
                    {path === '/how-it-works' && <div className="public-steps-grid"><article><span>01</span><h2>Create an account</h2><p>Register as a passenger or choose the driver path if you want to apply to drive.</p></article><article><span>02</span><h2>Enter your trip</h2><p>Passengers provide pickup and destination details and review the available trip information.</p></article><article><span>03</span><h2>Confirm online payment</h2><p>Use the supported online payment flow. A ride is not paid for with cash.</p></article><article><span>04</span><h2>Follow the ride</h2><p>Use your trip page to review status and the assigned driver and vehicle details when available.</p></article></div>}
                    {path === '/safety-info' && <><h2>Driver verification</h2><p>Drivers must complete the required onboarding and approval process before they can go online and accept rides. Document checks may include government identification, a driving licence and vehicle registration.</p><h2>Trip visibility</h2><p>Trip details help passengers recognise their assigned driver and vehicle. Use the in-app safety options if you need help during a trip.</p><h2>Location and privacy</h2><p>Location access should be used for features that need it, such as choosing a pickup or following an active trip. A home address is private account information and should not appear on the passenger-facing profile.</p><p className="public-notice"><ShieldCheck size={18} aria-hidden="true" /> Safety features and verification availability may depend on configured integrations and review status. Do not assume a document has been independently verified solely because it was uploaded.</p></>}
                    {path === '/drive' && <><h2>What you’ll need</h2><ul><li>Your personal and contact details.</li><li>Your home address for private account records.</li><li>Vehicle make, model, colour, registration number and operating area.</li><li>Required identity, driver’s licence and vehicle documents.</li><li>Any additional permits or insurance information requested during onboarding.</li></ul><h2>What happens next?</h2><p>Submit your information and documents for review. You must be approved before going online and accepting passenger requests.</p></>}
                    {path === '/faq' && <div className="public-faq-list"><details><summary>Can I use Tridash without creating an account?</summary><p>You can browse these public pages without an account. You’ll need to sign in or create an account to use ride-booking and workspace features.</p></details><details><summary>Can I pay the driver in cash?</summary><p>No. Tridash is configured for online payments only.</p></details><details><summary>How can I become a driver?</summary><p>Choose “Become a driver”, create an account with the driver role, and complete the required personal, vehicle and verification details.</p></details><details><summary>Can I go online immediately after registering?</summary><p>No. Driver approval is required before a driver can go online and accept rides.</p></details><details><summary>Will passengers see my home address?</summary><p>No. A driver's home address is private account information and should not be displayed in passenger-facing trip details.</p></details><details><summary>What if I need help during a trip?</summary><p>Open your trip and use the available in-app safety options. For account-specific assistance, sign in to your Tridash workspace.</p></details></div>}
                    {path === '/contact' && <><h2>Account and trip help</h2><p>Sign in to access your ride history, active trip information and the safety tools available in your workspace.</p><div className="public-contact-options"><a href={appHref('/login')}><UserRound aria-hidden="true" /><span><strong>Passenger or driver support</strong><small>Sign in to access your account and trip details.</small></span><ChevronRight aria-hidden="true" /></a><Link to="/safety-info"><ShieldCheck aria-hidden="true" /><span><strong>Safety information</strong><small>Review driver approval and trip safety guidance.</small></span><ChevronRight aria-hidden="true" /></Link></div><p className="public-muted-note">Official public support contact details will be published here when an official support channel is available.</p></>}
                    {path === '/privacy' && <><p><strong>Draft notice:</strong> This is a product-information summary, not a final legal privacy policy. Complete and legally review the policy before launch.</p><h2>Information the service may process</h2><ul><li>Account and contact details, such as name, email and phone number.</li><li>Trip details, including pickup, destination, status and payment status.</li><li>Location information when you use location-based ride features.</li><li>Driver verification documents and vehicle information submitted during onboarding.</li><li>Emergency contact details if you choose to provide them.</li></ul><h2>Why information is used</h2><p>Information is used to operate accounts, request and manage rides, support online payments, review driver applications, improve safety and respond to support needs.</p><h2>Sharing and access</h2><p>Information should be shared only as needed to operate the service—for example, relevant trip and vehicle details with the people involved in that trip, or required information with payment and verification providers. Access to sensitive documents and private account details should be restricted.</p><h2>Items to finalise before launch</h2><p>The operator must publish accurate retention periods, legal bases, data-subject request instructions, contact details, processor/vendor details and applicable jurisdiction-specific notices.</p></>}
                    {path === '/terms' && <><p><strong>Draft notice:</strong> These service expectations are a starting point, not final legal terms. Review and approve the full terms before launch.</p><h2>Using Tridash</h2><p>Provide accurate account and trip information, keep account access secure, and use the service lawfully and respectfully.</p><h2>Ride requests and payments</h2><p>Review the trip details before confirming. Tridash is configured for online payments only. A payment should be treated as complete only after the payment provider and Tridash confirm it.</p><h2>Driver accounts</h2><p>Drivers must provide accurate personal and vehicle information, submit the required documents and receive approval before going online or accepting rides. Approval may be withheld or withdrawn when required checks are incomplete or an account violates service rules.</p><h2>Cancellations and safety</h2><p>Use the in-app controls to manage or cancel eligible trips. Follow safety guidance and report concerns through available service channels.</p><h2>Before public launch</h2><p>Publish complete rules for eligibility, fares, cancellations, refunds, complaints, prohibited conduct, account suspension, liability, governing law and support contact details.</p></>}
                </section>
            </>}
        </main>
        <footer className="public-footer"><div className="public-footer-top"><div className="public-footer-brand"><Link to="/" className="public-brand"><span className="public-brand-mark"><Zap size={19} fill="currentColor" aria-hidden="true" /></span><span>tridash</span></Link><p>Local rides, made more straightforward.</p></div><div className="public-footer-links"><div><strong>Explore</strong><Link to="/how-it-works">How it works</Link><Link to="/safety-info">Safety</Link><Link to="/about">About</Link><Link to="/faq">FAQs</Link></div><div><strong>Get started</strong><a href={appHref('/signup')}>Book a ride</a><Link to="/drive">Become a driver</Link><Link to="/contact">Contact</Link><a href={appHref('/login')}>Sign in</a></div><div><strong>Legal</strong><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></div></div></div><div className="public-footer-bottom"><span>© {new Date().getFullYear()} Tridash</span><span>Built for clearer local journeys.</span></div></footer>
    </div>;
}

function NotFoundPage() {
    const navigate = useNavigate();
    useEffect(() => {
        const previousTitle = document.title;
        document.title = 'Page not found | Tridash';
        return () => { document.title = previousTitle; };
    }, []);

    return <main className="not-found-page" id="main-content">
        <ScrollToTopButton />
        <div className="not-found-topbar">
            <Link to="/" className="public-brand" aria-label="Tridash home"><span className="public-brand-mark"><Zap size={19} fill="currentColor" aria-hidden="true" /></span><span>tridash</span></Link>
            <span className="not-found-help">Need a hand? <Link to="/contact">Contact us</Link></span>
        </div>
        <section className="not-found-content" aria-labelledby="not-found-title">
            <div className="not-found-art" aria-hidden="true">
                <div className="not-found-orbit not-found-orbit-a" />
                <div className="not-found-orbit not-found-orbit-b" />
                <div className="not-found-map-pin"><MapPin size={54} strokeWidth={1.7} /></div>
                <span className="not-found-route-dot not-found-route-dot-a" />
                <span className="not-found-route-dot not-found-route-dot-b" />
                <span className="not-found-route-line" />
                <span className="not-found-error-code">404</span>
            </div>
            <p className="public-kicker"><span className="public-kicker-dot" /> WRONG TURN</p>
            <h1 id="not-found-title">Looks like this page took a detour.</h1>
            <p className="not-found-description">We can’t find the page you’re looking for. It may have moved, the address may be incorrect, or the link may have expired.</p>
            <div className="not-found-actions">
                <Link to="/" className="public-button"><Zap size={17} aria-hidden="true" /> Go to Tridash home</Link>
                <button type="button" className="public-button public-button-outline" onClick={() => navigate(-1)}>Go back</button>
            </div>
            <div className="not-found-suggestions"><span>Or try one of these:</span><Link to="/how-it-works">How it works</Link><Link to="/drive">Become a driver</Link><Link to="/faq">FAQs</Link></div>
        </section>
        <footer className="not-found-footer"><span>© {new Date().getFullYear()} Tridash</span><span>Local rides, made more straightforward.</span></footer>
    </main>;
}

// Google Maps universal navigation link. Coordinates are preferred because they
// are unambiguous; the address is only a fallback for trips booked without them.
// The `api=1` URL scheme is Google's documented cross-platform deep link, so it
// opens Google Maps on Android and iOS and the web app on desktop, without an
// API key or a Maps SDK dependency.
function googleMapsDirectionsUrl(from: { lat?: number; lng?: number } | null | undefined, to: { lat?: number; lng?: number } | null | undefined, fromLabel?: string, toLabel?: string): string {
    const encode = (coords: any, label?: string) => coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lng))
        ? Number(coords.lat) + ',' + Number(coords.lng)
        : encodeURIComponent(String(label || '').trim());
    const origin = encode(from, fromLabel);
    const destination = encode(to, toLabel);
    if (!origin || !destination) return '';
    return 'https://www.google.com/maps/dir/?api=1&origin=' + origin + '&destination=' + destination + '&travelmode=driving';
}

function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        confirmButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ));
            if (!focusable.length) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, []);

    return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}><div ref={dialogRef} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"><h3 id="confirm-title">{title}</h3><p id="confirm-description">{message}</p><div className="confirm-actions"><button type="button" className="secondary-button" onClick={onCancel}>Keep it</button><button ref={confirmButtonRef} type="button" className="primary-button danger-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}

function SharedTripRoute() {
    const { token } = useParams();
    const [state, setState] = useState<{ loading: boolean; ride: Ride | null; driver: any; error: string }>({ loading: true, ride: null, driver: null, error: '' });
    useEffect(() => {
        let mounted = true;
        api.get('/api/shared-trip/' + encodeURIComponent(token || '')).then(res => {
            if (mounted) setState({ loading: false, ride: res.data?.ride || null, driver: res.data?.driver || null, error: '' });
        }).catch((error: any) => {
            if (mounted) setState({ loading: false, ride: null, driver: null, error: error?.message || 'This tracking link is no longer available.' });
        });
        return () => { mounted = false; };
    }, [token]);
    if (state.loading) return <div className="loading-screen"><div className="brand"><span className="brand-mark"><Zap size={18} /></span>tridash</div><p>Loading shared trip…</p></div>;
    if (state.error || !state.ride) return <div className="mobile-frame"><div className="empty-card"><div className="empty-icon"><Search size={22} /></div><h2>Trip link unavailable</h2><p>{state.error || 'This shared trip could not be found.'}</p></div></div>;
    return <div className="mobile-frame"><div className="eyebrow">SHARED TRIP</div><h2 className="shared-trip-title">{state.ride.status}</h2><div className="status-card"><div className="status-icon"><Navigation size={24} /></div><div><strong>{state.ride.pickup} → {state.ride.destination}</strong><p>Estimated fare · ₦{Number(state.ride.amount || 0).toLocaleString()}</p></div></div><MapView pickup={state.ride.pickupCoords} destination={state.ride.destinationCoords} driverLocation={state.driver?.lastLocation || null} /><div className="driver-card"><div className="avatar">{String(state.driver?.name || state.ride.driver || 'TR').slice(0, 2).toUpperCase()}</div><div className="driver-info"><strong>{state.driver?.name || state.ride.driver || 'Driver pending'}</strong><span>{state.driver?.tricycle || 'Tridash driver'} · {state.ride.status}</span></div></div><p className="hint">This link is temporary and only shares the trip information needed for tracking.</p></div>;
}

function RideRoute({ rides, setSelectedRide, payRide, paymentBusy, driverLocation, cancelRide, backTarget = 'trips', viewAsDriver = false }: { rides: Ride[]; setSelectedRide: (ride: Ride | null) => void; payRide: any; paymentBusy: boolean; driverLocation: any; cancelRide?: any; backTarget?: string; viewAsDriver?: boolean }) {
    const { rideId } = useParams();
    const ride = rides.find(item => item.id === decodeURIComponent(rideId || ''));
    if (!ride) return <div className="mobile-frame"><div className="empty-card"><div className="empty-icon"><Search size={22} /></div><h2>Trip not found</h2><p>This trip is no longer available.</p><button className="primary-button" onClick={() => setSelectedRide(null)}>Return to trips</button></div></div>;
    return <RideDetail ride={ride} payRide={payRide} paymentBusy={paymentBusy} driverLocation={driverLocation} cancelRide={cancelRide} backTarget={backTarget} viewAsDriver={viewAsDriver} />;
}

function AuthScreen({ busy, onSignIn, onSignUp, onGoogleSignIn, onResetPassword }: { busy: boolean; onSignIn: (email: string, password: string) => Promise<boolean>; onSignUp: (name: string, email: string, password: string, role: 'passenger' | 'driver') => Promise<boolean>; onGoogleSignIn: () => Promise<boolean>; onResetPassword: (email: string) => Promise<boolean> }) {
    const authLocation = useLocation();
    const [mode, setMode] = useState<'signin' | 'signup'>(authLocation.pathname === '/signup' ? 'signup' : 'signin');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'passenger' | 'driver'>(new URLSearchParams(authLocation.search).get('role') === 'driver' ? 'driver' : 'passenger');
    const [errorText, setErrorText] = useState('');
    const [forgotMode, setForgotMode] = useState(false);

    useEffect(() => {
        setMode(authLocation.pathname === '/signup' ? 'signup' : 'signin');
        const requestedRole = new URLSearchParams(authLocation.search).get('role');
        setRole(requestedRole === 'driver' ? 'driver' : 'passenger');
        setErrorText('');
        setForgotMode(false);
    }, [authLocation.pathname, authLocation.search]);

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
            <Link className="auth-brand auth-brand-link" to="/" aria-label="Tridash home"><span className="brand-mark"><Zap size={18} /></span><strong>tridash</strong></Link>
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

function VerificationScreen({ busy, firebaseUser, onVerified, onRefresh, onResend, onSignOut }: { busy: boolean; firebaseUser: any; onVerified: (refreshed: any) => Promise<void>; onRefresh: () => Promise<void>; onResend: () => Promise<void>; onSignOut: () => Promise<void> }) {
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
            } catch { }
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
    const { tab, setTab, profile, activeRide, myTrips, requestRide, cancelRide, sendSOS, shareTrip, payRide, paymentBusy, saveProfile, profileBusy, notify, showRating, setShowRating, rating, setRating, review, setReview, submitRating, notificationsEnabled, enableNotifications, selectedRide, setSelectedRide, driverLocation } = props;
    const passengerTrips: Ride[] = Array.isArray(myTrips) ? myTrips : [];
    const recentTrips = passengerTrips
        .filter(ride => !activeRide || ride.id !== activeRide.id)
        .sort((first, second) => {
            const firstDate = first.requestedAt ? Date.parse(first.requestedAt) : 0;
            const secondDate = second.requestedAt ? Date.parse(second.requestedAt) : 0;
            return (Number.isFinite(secondDate) ? secondDate : 0) - (Number.isFinite(firstDate) ? firstDate : 0);
        })
        .slice(0, 3);
    const completedTrips = passengerTrips.filter(ride => ride.status === 'Completed').length;
    const openTrip = (ride: Ride) => {
        setSelectedRide(ride);
        navigateFromRoot(navigate, location.pathname, 'trips/' + encodeURIComponent(ride.id) + '?from=home');
    };

    if (tab === 'request') return <RequestPageMap requestRide={requestRide} setTab={setTab} notify={notify} profile={profile} />;
    if (selectedRide) return <RideDetail ride={selectedRide} payRide={payRide} paymentBusy={paymentBusy} driverLocation={driverLocation} cancelRide={cancelRide} />;
    if (tab === 'trips') return <TripsPage trips={myTrips} setSelectedRide={setSelectedRide} />;
    if (tab === 'safety') return <SafetyPage activeRide={activeRide} profile={profile} sendSOS={sendSOS} shareTrip={shareTrip} setTab={setTab} notify={notify} />;
    if (tab === 'profile') return <ProfilePage profile={profile} saveProfile={saveProfile} profileBusy={profileBusy} notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} setTab={setTab} />;

    return (
        <div className="mobile-frame passenger-home passenger-dashboard">
            <section className="hero-copy passenger-welcome">
                <div className="passenger-welcome-copy">
                    <div className="eyebrow">PASSENGER DASHBOARD</div>
                    <h1>Good to see you,<br /><strong>{profile.name || 'there'}</strong></h1>
                    <p>Your next local journey starts with a clear pickup, destination and driver details.</p>
                    <div className="passenger-welcome-actions">
                        <button className="primary-button" onClick={() => setTab('request')}>
                            <CarFront size={17} aria-hidden="true" /> Book a ride
                        </button>
                        <button className="passenger-hero-link" onClick={() => setTab('trips')}>
                            <History size={17} aria-hidden="true" /> View trip history
                        </button>
                    </div>
                </div>
                <div className="passenger-welcome-art" aria-hidden="true">
                    <div className="passenger-welcome-orbit passenger-welcome-orbit-one" />
                    <div className="passenger-welcome-orbit passenger-welcome-orbit-two" />
                    <div className="passenger-welcome-route-card">
                        <div className="passenger-welcome-route-heading"><span className="passenger-welcome-route-mark"><Zap size={13} /></span><span>YOUR NEXT JOURNEY</span></div>
                        <div className="passenger-welcome-route-point"><span className="passenger-welcome-route-dot" /><span><small>PICKUP</small><strong>Choose your location</strong></span></div>
                        <div className="passenger-welcome-route-point is-destination"><span className="passenger-welcome-route-dot" /><span><small>DESTINATION</small><strong>Where are you going?</strong></span></div>
                    </div>
                </div>
            </section>

            <div className="passenger-dashboard-grid">
                <div className="passenger-dashboard-main">
                    <section className="passenger-section-block">
                        <div className="passenger-section-heading">
                            <div>
                                <span className="passenger-section-kicker">ON THE MOVE</span>
                                <h2>{activeRide ? 'Your current ride' : 'Ready for your next ride?'}</h2>
                                <p>{activeRide ? 'Your trip details and current status are shown below.' : 'Set your pickup and destination to get started.'}</p>
                            </div>
                            {!activeRide && <button className="passenger-text-link" onClick={() => setTab('request')}>Start booking <ChevronRight size={16} aria-hidden="true" /></button>}
                        </div>
                        {activeRide
                            ? <ActiveRideCard ride={activeRide} driverLocation={driverLocation} onClick={() => openTrip(activeRide)} />
                            : <PassengerBookingCard onRequest={() => setTab('request')} />}
                    </section>

                    <section className="passenger-section-block passenger-recent-section">
                        <div className="passenger-section-heading">
                            <div>
                                <span className="passenger-section-kicker">YOUR ACTIVITY</span>
                                <h2>Recent trips</h2>
                                <p>Your latest journeys, all in one place.</p>
                            </div>
                            <button className="passenger-text-link" onClick={() => setTab('trips')}>View all <ChevronRight size={16} aria-hidden="true" /></button>
                        </div>
                        {recentTrips.length > 0 ? (
                            <div className="passenger-recent-list">
                                {recentTrips.map(ride => <PassengerTripRow key={ride.id} ride={ride} onClick={() => openTrip(ride)} />)}
                            </div>
                        ) : (
                            <div className="passenger-history-empty">
                                <span className="passenger-history-empty-icon"><History size={19} aria-hidden="true" /></span>
                                <div>
                                    <strong>No previous trips yet</strong>
                                    <p>When you complete a ride, its route and details will appear here.</p>
                                </div>
                                <button className="secondary-button compact" onClick={() => setTab('request')}>Plan a ride</button>
                            </div>
                        )}
                    </section>
                </div>

                <aside className="passenger-dashboard-aside" aria-label="Passenger account overview">
                    <div className="passenger-stat-grid">
                        <article className="passenger-stat-card">
                            <span className="passenger-stat-label">TOTAL TRIPS</span>
                            <strong>{passengerTrips.length}</strong>
                            <small>On your account</small>
                        </article>
                        <article className="passenger-stat-card is-complete">
                            <span className="passenger-stat-label">COMPLETED</span>
                            <strong>{completedTrips}</strong>
                            <small>Successfully finished</small>
                        </article>
                    </div>

                    <section className="passenger-quick-panel">
                        <div className="passenger-quick-heading">
                            <span className="passenger-section-kicker">QUICK ACCESS</span>
                            <h2>Useful shortcuts</h2>
                        </div>
                        <button className="passenger-shortcut" onClick={() => setTab('safety')}>
                            <span className="passenger-shortcut-icon safety"><ShieldCheck size={18} aria-hidden="true" /></span>
                            <span><strong>Safety centre</strong><small>Emergency tools and trip sharing</small></span>
                            <ChevronRight size={17} aria-hidden="true" />
                        </button>
                        <button className="passenger-shortcut" onClick={() => setTab('profile')}>
                            <span className="passenger-shortcut-icon profile"><UserRound size={18} aria-hidden="true" /></span>
                            <span><strong>Profile & contacts</strong><small>Manage your details and emergency contact</small></span>
                            <ChevronRight size={17} aria-hidden="true" />
                        </button>
                        <button className="passenger-shortcut" onClick={() => setTab('trips')}>
                            <span className="passenger-shortcut-icon trips"><History size={18} aria-hidden="true" /></span>
                            <span><strong>Trip history</strong><small>Review previous journeys</small></span>
                            <ChevronRight size={17} aria-hidden="true" />
                        </button>
                    </section>

                    <section className="passenger-trust-panel">
                        <span className="passenger-trust-icon"><ShieldCheck size={20} aria-hidden="true" /></span>
                        <div>
                            <strong>Every ride has a record.</strong>
                            <p>Find your trip details, driver information and available safety tools in one place.</p>
                        </div>
                    </section>
                </aside>
            </div>

            <BottomNav tab={tab} setTab={setTab} />
            {showRating && <RatingModal rating={rating} setRating={setRating} review={review} setReview={setReview} submit={submitRating} close={() => setShowRating(false)} />}
        </div>
    );
}

function PassengerBookingCard({ onRequest }: { onRequest: () => void }) {
    return (
        <section className="passenger-booking-card">
            <div className="passenger-booking-visual" aria-hidden="true">
                <div className="passenger-booking-map-grid" />
                <div className="passenger-booking-route-line" />
                <span className="passenger-booking-pin pickup"><MapPin size={17} /></span>
                <span className="passenger-booking-pin destination"><MapPin size={17} /></span>
                <span className="passenger-booking-vehicle"><CarFront size={19} /></span>
            </div>
            <div className="passenger-booking-copy">
                <span className="passenger-section-kicker">BOOK YOUR NEXT RIDE</span>
                <h3>Where would you like to go?</h3>
                <p>Choose your pickup point and destination. You can review the route and fare before sending a request.</p>
                <button className="primary-button" onClick={onRequest}>Choose pickup & destination <ChevronRight size={17} aria-hidden="true" /></button>
            </div>
        </section>
    );
}

function PassengerTripRow({ ride, onClick }: { ride: Ride; onClick: () => void }) {
    const amount = Number(ride.amount || 0);
    const statusClass = ride.status.toLowerCase().replace(/ /g, '-');

    return (
        <button className="passenger-trip-row" onClick={onClick} aria-label={`Open trip to ${ride.destination}`}>
            <span className="passenger-trip-icon"><CarFront size={18} aria-hidden="true" /></span>
            <span className="passenger-trip-copy">
                <strong>{ride.destination || 'Destination not recorded'}</strong>
                <small><span>{ride.pickup || 'Pickup not recorded'}</span><span className="passenger-trip-separator">·</span><span>{formatPassengerTripDate(ride.requestedAt)}</span></small>
            </span>
            <span className={'passenger-trip-status ' + statusClass}>{ride.status}</span>
            <strong className="passenger-trip-amount">₦{amount.toLocaleString()}</strong>
            <ChevronRight className="passenger-trip-chevron" size={17} aria-hidden="true" />
        </button>
    );
}

function formatPassengerTripDate(value?: string) {
    if (!value) return 'Date unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function ActiveRideCard({ ride, driverLocation, onClick }: any) {
    return <section className="ride-card ride-card-map">
        <div className="card-top"><div><span className="eyebrow">CURRENT TRIP</span><strong className="ride-card-heading">{ride.status === 'Requested' ? 'Finding your driver' : ride.status === 'Accepted' ? 'Driver assigned' : 'Your ride is underway'}</strong></div><span className={'ride-status ' + ride.status.toLowerCase().replace(/ /g, '-')}>{ride.status}</span></div>
        <button className="ride-route-action" onClick={onClick} aria-label="Open current trip details"><div className="route"><RoutePoint label="FROM" value={ride.pickup} /><RoutePoint label="TO" value={ride.destination} destination /></div></button>
        <MapView pickup={ride.pickupCoords} destination={ride.destinationCoords} driverLocation={driverLocation} followDriver={ride.status === 'In Progress'} />
        <div className="ride-card-meta"><span><ShieldCheck size={15} /> {ride.driver ? 'Verified driver' : 'Matching with a verified driver'}</span><strong>₦{ride.amount.toLocaleString()}</strong></div>
        <button className="primary-button full ride-view-button" onClick={onClick}>View trip details <ChevronRight size={17} /></button>
    </section>;
}
function RoutePoint({ label, value, destination }: any) { return <div className="route-point"><span className={'dot ' + (destination ? 'destination-dot' : '')} /><div><small>{label}</small><strong>{value}</strong></div></div>; }

function RideDetail({ ride, payRide, paymentBusy, driverLocation, cancelRide, backTarget = 'trips', viewAsDriver = false }: any) {
    const navigate = useNavigate();
    const detailLocation = useLocation();
    const fromHome = new URLSearchParams(detailLocation.search).get('from') === 'home';
    // A driver opening the trip navigates from their own position to the pickup
    // until the trip starts, and from the pickup to the drop-off afterwards.
    const navigatingToPickup = ride.status === 'Accepted';
    const directionsUrl = viewAsDriver
        ? googleMapsDirectionsUrl(
            navigatingToPickup ? driverLocation : ride.pickupCoords,
            navigatingToPickup ? ride.pickupCoords : ride.destinationCoords,
            navigatingToPickup ? 'Your location' : ride.pickup,
            navigatingToPickup ? ride.pickup : ride.destination
        )
        : googleMapsDirectionsUrl(ride.pickupCoords, ride.destinationCoords, ride.pickup, ride.destination);
    return <div className="mobile-frame trip-detail-page">
        <section className="screen-head"><button className="back-button" onClick={() => navigateFromRoot(navigate, detailLocation.pathname, fromHome ? '' : backTarget)}>←</button><div><div className="eyebrow">TRIP DETAILS</div><h2>{ride.status}</h2></div></section>
        <MapView pickup={ride.pickupCoords} destination={ride.destinationCoords} driverLocation={driverLocation} followDriver={ride.status === 'In Progress'} />
        {directionsUrl && <a className="navigate-button" href={directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={17} /> {viewAsDriver ? (navigatingToPickup ? 'Navigate to pickup in Google Maps' : 'Navigate to drop-off in Google Maps') : 'Open route in Google Maps'}</a>}
        {viewAsDriver
            ? <div className="driver-card"><div className="avatar">{String(ride.passenger || 'PA').slice(0, 2).toUpperCase()}</div><div className="driver-info"><strong>{ride.passenger || 'Passenger'}</strong><span>Passenger · {ride.tricycle || 'Tridash tricycle'}</span></div>{ride.riderPhone && <a className="call-button" href={'tel:' + ride.riderPhone} aria-label={'Call ' + ride.passenger}><Phone size={17} /></a>}</div>
            : <div className="driver-card"><div className="avatar">{(ride.driver || 'DR').split(' ').map((x: string) => x[0]).join('')}</div><div className="driver-info"><strong>{ride.driver || 'Driver search in progress'}</strong><span>{ride.tricycle || 'Tricycle pending'} · <Star size={13} fill="currentColor" /> {ride.rating || '—'}</span>{[ride.driverVehicleMake, ride.driverVehicleModel, ride.driverVehicleColor].filter(Boolean).length > 0 && <small>{[ride.driverVehicleMake, ride.driverVehicleModel, ride.driverVehicleColor].filter(Boolean).join(' · ')}</small>}{ride.driverPhone && <small>{ride.driverPhone}</small>}</div>{ride.driver && <>{ride.driverPhone ? <a className="call-button" href={'tel:' + ride.driverPhone} aria-label={'Call ' + ride.driver}><Phone size={17} /></a> : <span className="hint">Driver phone unavailable</span>}<span className="verified"><ShieldCheck size={14} /> Verified</span></>}</div>}
        <div className="trip-details"><div><span>FROM</span><strong>{ride.pickup}</strong></div><div><span>TO</span><strong>{ride.destination}</strong></div></div>{ride.riderPhone && !viewAsDriver && <div className="trip-details"><div><span>RIDER</span><strong>{ride.riderName || ride.passenger}</strong></div><div><span>CONTACT</span><strong>{ride.riderPhone}</strong></div></div>}
        <div className="payment-box"><div><span>FARE</span><strong>₦{ride.amount.toLocaleString()}</strong></div><div><span>PAYMENT</span><strong>{ride.paymentStatus || 'Pending'}</strong></div></div>
        {ride.status !== 'Completed' && ride.status !== 'Cancelled' && cancelRide && <div className="payment-actions"><button className="secondary-button danger-button full" onClick={() => cancelRide(ride)}>Cancel ride</button></div>}
        {ride.status === 'Completed' && ride.paymentStatus !== 'Paid' && !viewAsDriver && <div className="payment-actions"><button className="primary-button" disabled={paymentBusy} onClick={() => payRide(ride)}>{paymentBusy ? 'Opening secure checkout…' : 'Pay online with Paystack'}</button></div>}
        {ride.status === 'Completed' && ride.paymentStatus !== 'Paid' && !viewAsDriver && <p className="hint">Online payment is securely processed by Paystack. Tridash verifies the transaction and exact fare before marking the ride paid.</p>}
    </div>;
}

function TripsPage({ trips, setSelectedRide, workspace = 'rider' }: any) {
    const navigate = useNavigate();
    const location = useLocation();
    const tripDetailTarget = workspace === 'driver' ? 'driver/trips/' : 'trips/';
    const backTarget = workspace === 'driver' ? 'driver' : '';
    const openTrip = (ride: Ride) => {
        if (typeof setSelectedRide === 'function') setSelectedRide(ride);
        navigateFromRoot(navigate, location.pathname, tripDetailTarget + encodeURIComponent(ride.id));
    };

    return (
        <div className="mobile-frame trip-history-page">
            <section className="screen-head">
                <button
                    className="back-button"
                    aria-label="Back to workspace"
                    onClick={() => navigateFromRoot(navigate, location.pathname, backTarget)}
                >
                    ←
                </button>
                <div>
                    <div className="eyebrow">YOUR RIDES</div>
                    <h2>Trip history</h2>
                </div>
            </section>
            {trips.length ? trips.map((ride: Ride) => (
                <button className="history-item" key={ride.id} onClick={() => openTrip(ride)}>
                    <div className="history-icon"><CarFront size={18} /></div>
                    <div>
                        <strong>{ride.destination}</strong>
                        <span>{ride.driver || 'Driver pending'} · {ride.status}</span>
                    </div>
                    <b>₦{ride.amount.toLocaleString()}</b>
                </button>
            )) : (
                <div className="empty-card">
                    <div className="empty-icon"><History size={22} /></div>
                    <h2>No trips yet</h2>
                    <p>Your completed and cancelled trips will appear here.</p>
                </div>
            )}
        </div>
    );
}

function SafetyPage({ activeRide, profile, sendSOS, shareTrip, setTab, notify }: any) {
    return (
        <div className="mobile-frame safety-page">
            <section className="screen-head">
                <button className="back-button" aria-label="Back to home" onClick={() => setTab('home')}>←</button>
                <div>
                    <div className="eyebrow">SAFETY CENTRE</div>
                    <h2>Ride with confidence</h2>
                </div>
            </section>
            <div className="safety-hero">
                <ShieldAlert size={30} />
                <strong>SOS on every trip</strong>
                <p>Use SOS when you need urgent assistance. Tridash records the incident with your trip reference.</p>
                <button className="sos-large" disabled={!activeRide} onClick={sendSOS}>
                    <AlertTriangle size={21} />
                    {activeRide ? 'ACTIVATE SOS' : 'NO ACTIVE TRIP'}
                </button>
            </div>
            <div className="safety-list">
                <div>
                    <ShieldCheck size={20} />
                    <span>
                        <strong>Verified drivers</strong>
                        <small>Identity, driving licence and vehicle checks must be completed before a driver is approved.</small>
                    </span>
                </div>
                <div>
                    <Users size={20} />
                    <span>
                        <strong>Emergency contact</strong>
                        <small>{profile.emergencyName ? profile.emergencyName + ' · ' + profile.emergencyPhone : 'Add an emergency contact in Profile.'}</small>
                    </span>
                </div>
                <div>
                    <Navigation size={20} />
                    <span>
                        <strong>Share trip</strong>
                        <small>Send route and status to someone you trust.</small>
                    </span>
                    <button className="secondary-button" disabled={!activeRide} onClick={shareTrip}>Share</button>
                </div>
            </div>
            <IncidentReportButton activeRide={activeRide} notify={notify} />
        </div>
    );
}

function ProfilePage({ profile, saveProfile, profileBusy, notificationsEnabled, enableNotifications, setTab }: any) {
    const [form, setForm] = useState(profile);

    return (
        <div className="mobile-frame profile-page">
            <section className="screen-head">
                <button className="back-button" aria-label="Back to home" onClick={() => setTab('home')}>←</button>
                <div>
                    <div className="eyebrow">ACCOUNT</div>
                    <h2>Profile & settings</h2>
                </div>
            </section>
            <div className="profile-card">
                <div className="avatar large">{form.name.slice(0, 2).toUpperCase() || 'TR'}</div>
                <div>
                    <strong>{form.name || 'Your profile'}</strong>
                    <span>{form.phone || 'Add your phone number'}</span>
                </div>
            </div>
            <div className="form-card">
                <label>Full name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
                <label>Phone<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="080..." /></label>
                <label>Emergency contact name<input value={form.emergencyName} onChange={event => setForm({ ...form, emergencyName: event.target.value })} /></label>
                <label>Emergency contact phone<input value={form.emergencyPhone} onChange={event => setForm({ ...form, emergencyPhone: event.target.value })} placeholder="080..." /></label>
                <button
                    className="primary-button full"
                    disabled={profileBusy}
                    aria-busy={profileBusy}
                    onClick={() => saveProfile(form)}
                >
                    {profileBusy ? 'Saving profile…' : 'Save profile'}
                </button>
            </div>
            <div className="settings-row">
                <Bell size={19} />
                <div>
                    <strong>Push notifications</strong>
                    <span>{notificationsEnabled ? 'Enabled' : 'Receive ride and safety updates'}</span>
                </div>
                <button className="secondary-button" onClick={enableNotifications}>
                    {notificationsEnabled ? 'Enabled' : 'Enable'}
                </button>
            </div>
        </div>
    );
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
    return <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={close}><X /></button><div className="eyebrow">TRIP COMPLETED</div><h2>How was your trip?</h2><p>Rate your driver and leave a short review.</p><div className="stars">{[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setRating(n)} className={n <= rating ? 'star-on' : ''}><Star fill="currentColor" /></button>)}</div><textarea value={review} onChange={e => setReview(e.target.value)} placeholder="Tell us about your trip (optional)" /><button className="primary-button full" onClick={submit}>Submit rating</button></div></div>;
}

function DriverWorkspace({ tab, setTab, driver, requests, activeRide, rides, updateRide, acceptRide, rejectRide, toggleOnline, notify, saveProfile, profile, driverLocation, setDriverProfile }: any) {
    const driverName = String(driver?.name || profile?.name || 'Driver');
    const belongsToDriver = (ride: Ride) => (
        Boolean(driver?.userId && ride.driverId === driver.userId) ||
        Boolean(ride.driver && ride.driver === driverName)
    );
    const myDriverRides = rides.filter((ride: Ride) => belongsToDriver(ride));
    const completedDriverTrips = myDriverRides.filter((ride: Ride) => ride.status === 'Completed');
    const recentDriverTrips = [...myDriverRides]
        .sort((a, b) => new Date(b.completedAt || b.requestedAt || 0).getTime() - new Date(a.completedAt || a.requestedAt || 0).getTime())
        .slice(0, 4);
    const visibleRequests = requests.filter((ride: Ride) => (
        !(ride.rejectedByDriverIds || []).includes(driver?.userId) &&
        !(ride.rejectedByDriverIds || []).includes(driver?.id)
    ));
    const assignedActiveRide = myDriverRides.find((ride: Ride) => ['Accepted', 'In Progress'].includes(ride.status)) || (activeRide && belongsToDriver(activeRide) ? activeRide : null);
    const hasPayoutAccount = Boolean(driver?.payoutSubaccountCode);
    const canGoOnline = Boolean(driver?.verified && hasPayoutAccount);
    const completedFareValue = completedDriverTrips.reduce((total: number, ride: Ride) => total + Number(ride.amount || 0), 0);
    const ratingValue = Number(driver?.rating || 0);
    const verificationState = String(driver?.verificationStatus || (driver?.verified ? 'verified' : 'pending')).toLowerCase();
    const verificationLabel = driver?.verified
        ? 'Verified driver'
        : ['rejected', 'needs_review', 'incomplete'].includes(verificationState)
            ? 'Action required'
            : 'Verification pending';

    if (tab === 'requests') {
        return (
            <>
                <DriverRequests
                    requests={requests}
                    driver={driver}
                    acceptRide={acceptRide}
                    rejectRide={rejectRide}
                    setTab={setTab}
                    toggleOnline={toggleOnline}
                />
                <BottomNav tab={tab} setTab={setTab} driver />
            </>
        );
    }

    if (tab === 'trips') {
        return (
            <>
                <TripsPage trips={myDriverRides} workspace="driver" />
                <BottomNav tab={tab} setTab={setTab} driver />
            </>
        );
    }

    if (tab === 'profile') {
        return (
            <>
                <DriverProfilePage
                    profile={{ ...profile, role: 'driver' }}
                    driver={driver}
                    saveProfile={saveProfile}
                    notify={notify}
                    setTab={setTab}
                    setDriverProfile={setDriverProfile}
                />
                <BottomNav tab={tab} setTab={setTab} driver />
            </>
        );
    }

    return (
        <div className="mobile-frame driver-dashboard">
            <section className="driver-dashboard-hero">
                <div className="driver-dashboard-hero-copy">
                    <span className="driver-dashboard-kicker">DRIVER WORKSPACE</span>
                    <h1>Good to see you, <strong>{driverName.split(' ')[0]}</strong></h1>
                    <p>Manage your availability, respond to ride requests and keep every trip on track.</p>
                    <div className="driver-dashboard-hero-meta">
                        <span className={driver?.verified ? 'driver-hero-badge is-verified' : 'driver-hero-badge is-pending'}>
                            <ShieldCheck size={14} aria-hidden="true" />
                            {verificationLabel}
                        </span>
                        {driver?.tricycle && <span className="driver-hero-vehicle"><CarFront size={14} aria-hidden="true" /> {driver.tricycle}</span>}
                    </div>
                </div>
                <div className="driver-dashboard-presence">
                    <span className="driver-dashboard-presence-label">YOUR AVAILABILITY</span>
                    <div className="driver-dashboard-presence-state">
                        <span className={'status-dot ' + (driver?.online ? '' : 'offline')} />
                        <strong>{driver?.online ? 'Online' : 'Offline'}</strong>
                    </div>
                    <button
                        className="driver-presence-toggle"
                        type="button"
                        onClick={toggleOnline}
                        disabled={!canGoOnline}
                    >
                        {driver?.online ? 'Go offline' : 'Go online'}
                    </button>
                    {!canGoOnline && (
                        <small>{!driver?.verified ? 'Complete driver verification to go online.' : 'Add a payout account to go online.'}</small>
                    )}
                </div>
            </section>

            <section className="driver-metric-grid" aria-label="Driver performance summary">
                <DriverMetric label="Completed trips" value={completedDriverTrips.length} detail="Trips completed" icon={History} tone="green" />
                <DriverMetric label="Open requests" value={visibleRequests.length} detail="Awaiting driver assignment" icon={Activity} tone="amber" />
                <DriverMetric label="Driver rating" value={ratingValue > 0 ? ratingValue.toFixed(1) : '—'} detail={ratingValue > 0 ? 'Recorded passenger rating' : 'No rating recorded yet'} icon={Star} tone="gold" />
                <DriverMetric label="Completed fare value" value={`₦${completedFareValue.toLocaleString()}`} detail="Gross fares on completed trips" icon={CreditCard} tone="navy" />
            </section>

            <div className="driver-dashboard-grid">
                <main className="driver-dashboard-main">
                    <section className="driver-dashboard-section">
                        <div className="driver-dashboard-section-head">
                            <div>
                                <span className="driver-dashboard-section-kicker">CURRENT WORK</span>
                                <h2>{assignedActiveRide ? 'Your active trip' : 'Ready for your next request?'}</h2>
                                <p>{assignedActiveRide ? 'Trip status, passenger details and navigation.' : 'Your ride activity and next available action.'}</p>
                            </div>
                            {!assignedActiveRide && (
                                <button className="driver-dashboard-link" type="button" onClick={() => setTab('requests')}>
                                    View requests <ChevronRight size={16} aria-hidden="true" />
                                </button>
                            )}
                        </div>
                        {assignedActiveRide ? (
                            <ActiveDriverRide
                                ride={assignedActiveRide}
                                updateRide={updateRide}
                                notify={notify}
                                driverLocation={driverLocation}
                            />
                        ) : (
                            <div className="driver-next-action-card">
                                <span className="driver-next-action-icon"><CarFront size={22} aria-hidden="true" /></span>
                                <div>
                                    <strong>{driver?.online ? 'You are ready to receive rides' : 'You are currently offline'}</strong>
                                    <p>{driver?.online ? 'New passenger requests will appear in your request queue.' : 'Go online when you are ready to accept passenger requests.'}</p>
                                    <button className="primary-button" type="button" onClick={() => setTab('requests')}>
                                        Open ride requests <ChevronRight size={17} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="driver-dashboard-section driver-recent-section">
                        <div className="driver-dashboard-section-head">
                            <div>
                                <span className="driver-dashboard-section-kicker">TRIP ACTIVITY</span>
                                <h2>Recent trips</h2>
                                <p>Your latest assigned and completed journeys.</p>
                            </div>
                            <button className="driver-dashboard-link" type="button" onClick={() => setTab('trips')}>
                                View history <ChevronRight size={16} aria-hidden="true" />
                            </button>
                        </div>
                        {recentDriverTrips.length ? (
                            <div className="driver-recent-list">
                                {recentDriverTrips.map((ride: Ride) => (
                                    <DriverActivityRow key={ride.id} ride={ride} onClick={() => setTab('trips')} />
                                ))}
                            </div>
                        ) : (
                            <div className="driver-dashboard-empty">
                                <span><History size={19} aria-hidden="true" /></span>
                                <div>
                                    <strong>No trip activity yet</strong>
                                    <p>Accepted and completed passenger journeys will appear here.</p>
                                </div>
                            </div>
                        )}
                    </section>
                </main>

                <aside className="driver-dashboard-aside" aria-label="Driver account and requests">
                    <section className="driver-side-card driver-verification-panel">
                        <div className="driver-side-card-heading">
                            <span className="driver-side-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
                            <span className={driver?.verified ? 'driver-side-status is-verified' : 'driver-side-status is-pending'}>
                                {driver?.verified ? 'Verified' : verificationLabel}
                            </span>
                        </div>
                        <span className="driver-dashboard-section-kicker">ACCOUNT VERIFICATION</span>
                        <h3>{driver?.verified ? 'Your account is verified' : verificationState === 'rejected' ? 'Review your verification' : 'Complete your verification'}</h3>
                        <p>{driver?.verified ? 'Your driver identity and vehicle checks have been approved.' : verificationState === 'rejected' ? 'Some submitted information needs attention. Review the feedback and update the required documents.' : 'Submit the required identity, licence and vehicle documents to become eligible for ride requests.'}</p>
                        <button className="driver-dashboard-link" type="button" onClick={() => setTab('profile')}>
                            {driver?.verified ? 'Review driver profile' : 'Continue verification'} <ChevronRight size={16} aria-hidden="true" />
                        </button>
                    </section>

                    {!hasPayoutAccount && (
                        <section className="driver-payout-panel">
                            <span className="driver-payout-icon"><Landmark size={18} aria-hidden="true" /></span>
                            <span className="driver-dashboard-section-kicker">ACTION REQUIRED</span>
                            <h3>Add your payout account</h3>
                            <p>Connect your bank account before switching online and accepting rides.</p>
                            <button className="primary-button full" type="button" onClick={() => setTab('profile')}>
                                Add payout details <ChevronRight size={17} aria-hidden="true" />
                            </button>
                        </section>
                    )}

                    <section className="driver-side-card driver-request-preview">
                        <div className="driver-dashboard-section-head">
                            <div>
                                <span className="driver-dashboard-section-kicker">RIDE QUEUE</span>
                                <h3>New requests</h3>
                            </div>
                            <span className="driver-request-count">{visibleRequests.length}</span>
                        </div>
                        {visibleRequests.length ? (
                            <div className="driver-request-preview-list">
                                {visibleRequests.slice(0, 3).map((ride: Ride) => (
                                    <button className="driver-request-preview-row" key={ride.id} type="button" onClick={() => setTab('requests')}>
                                        <span className="driver-request-route-mark"><MapPin size={16} aria-hidden="true" /></span>
                                        <span className="driver-request-preview-copy">
                                            <strong>{ride.pickup}</strong>
                                            <small>To {ride.destination}</small>
                                        </span>
                                        <b>₦{Number(ride.amount || 0).toLocaleString()}</b>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="driver-request-none">No new ride requests at the moment.</p>
                        )}
                        <button className="driver-dashboard-link" type="button" onClick={() => setTab('requests')}>
                            Open request queue <ChevronRight size={16} aria-hidden="true" />
                        </button>
                    </section>
                </aside>
            </div>

            <BottomNav tab={tab} setTab={setTab} driver />
        </div>
    );
}

function DriverMetric({ label, value, detail, icon: Icon, tone }: any) {
    return (
        <article className={`driver-metric-card is-${tone}`}>
            <span className="driver-metric-icon"><Icon size={18} aria-hidden="true" /></span>
            <span className="driver-metric-label">{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
        </article>
    );
}

function DriverActivityRow({ ride, onClick }: { ride: Ride; onClick: () => void }) {
    const dateValue = ride.completedAt || ride.requestedAt;
    const tripDate = dateValue && !Number.isNaN(new Date(dateValue).getTime())
        ? new Date(dateValue).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        : 'Date unavailable';
    const statusClass = ride.status.toLowerCase().replace(/ /g, '-');

    return (
        <button className="driver-activity-row" type="button" onClick={onClick}>
            <span className="driver-activity-icon"><CarFront size={18} aria-hidden="true" /></span>
            <span className="driver-activity-copy">
                <strong>{ride.destination || 'Destination not recorded'}</strong>
                <small>{ride.passenger || 'Passenger'} · {tripDate}</small>
            </span>
            <span className={`driver-activity-status ${statusClass}`}>{ride.status}</span>
            <b>₦{Number(ride.amount || 0).toLocaleString()}</b>
            <ChevronRight size={16} aria-hidden="true" />
        </button>
    );
}

function DriverRequests({ requests, driver, acceptRide, rejectRide, setTab, toggleOnline }: any) {
    const hasPayoutAccount = Boolean(driver?.payoutSubaccountCode);
    const canManage = !!driver?.verified && !!driver?.online && hasPayoutAccount;
    const visibleRequests = requests.filter((ride: Ride) =>
        !(ride.rejectedByDriverIds || []).includes(driver?.userId) &&
        !(ride.rejectedByDriverIds || []).includes(driver?.id)
    );

    return (
        <div className="mobile-frame driver-requests-page">
            <section className="screen-head">
                <button className="back-button" aria-label="Back to driver home" onClick={() => setTab('home')}>←</button>
                <div>
                    <div className="eyebrow">RIDE REQUESTS</div>
                    <h2>Available trips</h2>
                </div>
            </section>
            <div className="driver-availability-card">
                <div>
                    <strong>{driver?.online ? 'You are online' : 'You are offline'}</strong>
                    <span>
                        {driver?.verified
                            ? (driver?.online ? 'Passenger requests can be accepted or declined.' : 'Go online to manage requests.')
                            : 'Your driver account must be verified before you can manage requests.'}
                    </span>
                </div>
                {driver?.verified && (
                    <button disabled={!hasPayoutAccount} onClick={toggleOnline}>{driver?.online ? 'Go offline' : 'Go online'}</button>
                )}
            </div>
            {visibleRequests.length ? visibleRequests.map((ride: Ride) => (
                <div className="request-card" key={ride.id}>
                    <div>
                        <span className="eyebrow">PICKUP</span>
                        <strong>{ride.pickup}</strong>
                        <span className="destination-line">→ {ride.destination}</span>
                        <span className="request-meta"><MapPin size={13} /> Passenger {ride.passenger}</span>
                    </div>
                    <div className="request-actions">
                        <div>
                            <b>₦{ride.amount.toLocaleString()}</b>
                            <div className="request-readiness">
                                {!driver?.verified
                                    ? 'Awaiting verification'
                                    : !driver?.online
                                        ? 'Go online to manage'
                                        : !hasPayoutAccount
                                            ? 'Add payout account'
                                            : 'Ready'}
                            </div>
                        </div>
                        <div className="request-action-buttons">
                            <button className="secondary-button compact" disabled={!canManage} onClick={() => rejectRide(ride)}>
                                Reject
                            </button>
                            <button
                                className="primary-button"
                                disabled={!canManage}
                                onClick={async () => {
                                    const accepted = await acceptRide(ride);
                                    if (accepted) setTab('home');
                                }}
                            >
                                Accept
                            </button>
                        </div>
                    </div>
                </div>
            )) : (
                <div className="empty-card">
                    <div className="empty-icon"><Clock3 size={22} /></div>
                    <h2>No requests yet</h2>
                    <p>Stay online to receive nearby passenger requests.</p>
                </div>
            )}
        </div>
    );
}

const PHONE_COUNTRY_CODES = [
    { label: 'Nigeria (+234)', value: '+234' },
    { label: 'Ghana (+233)', value: '+233' },
    { label: 'Cameroon (+237)', value: '+237' },
    { label: 'Kenya (+254)', value: '+254' },
    { label: 'South Africa (+27)', value: '+27' },
    { label: 'United Kingdom (+44)', value: '+44' },
    { label: 'United States / Canada (+1)', value: '+1' },
];

function splitInternationalPhone(rawPhone: string) {
    const phone = String(rawPhone || '').trim();
    const digits = phone.replace(/\D/g, '');
    if (phone.startsWith('+')) {
        const match = [...PHONE_COUNTRY_CODES].sort((a, b) => b.value.length - a.value.length).find(item => digits.startsWith(item.value.slice(1)));
        if (match) return { phoneCountryCode: match.value, phoneNationalNumber: digits.slice(match.value.length - 1) };
    }
    return { phoneCountryCode: '+234', phoneNationalNumber: digits.replace(/^0+/, '') };
}

function composeInternationalPhone(countryCode: string, nationalNumber: string) {
    return `${countryCode}${String(nationalNumber || '').replace(/\D/g, '').replace(/^0+/, '')}`;
}

function DriverProfilePage({ profile, driver, saveProfile, notify, setTab, setDriverProfile }: any) {
    const [savedDriver, setSavedDriver] = useState(driver);
    const [form, setForm] = useState({
        firstName: driver.firstName || '', lastName: driver.lastName || '', otherNames: driver.otherNames || '',
        dateOfBirth: driver.dateOfBirth ? String(driver.dateOfBirth).slice(0, 10) : '',
        ...splitInternationalPhone(driver.phone || profile.phone || ''), homeAddress: driver.homeAddress || '', tricycle: driver.tricycle || '', vehicleMake: driver.vehicleMake || '', vehicleModel: driver.vehicleModel || '', vehicleColor: driver.vehicleColor || '', operatingState: driver.operatingState || 'Ebonyi', operatingArea: driver.operatingArea || '', emergencyName: profile.emergencyName || '', emergencyPhone: profile.emergencyPhone || '',
    });
    const [documents, setDocuments] = useState<any[]>([]);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [locatingHome, setLocatingHome] = useState(false);
    const [profileSaved, setProfileSaved] = useState(Boolean(driver.firstName && driver.lastName && driver.dateOfBirth && driver.homeAddress && driver.tricycle && driver.vehicleMake && driver.vehicleModel && driver.vehicleColor && driver.operatingArea));
    const [uploading, setUploading] = useState<string | null>(null);
    const [lastChecks, setLastChecks] = useState<any>(null);

    const loadVerification = async () => {
        try {
            const result = await api.get('/api/driver/me/verification');
            if (result.data?.driver) {
                const saved = result.data.driver;
                setSavedDriver(saved);
                setDriverProfile?.((current: any) => ({ ...(current || {}), ...saved }));
                setProfileSaved(Boolean(saved.firstName && saved.lastName && saved.dateOfBirth && saved.homeAddress && saved.tricycle && saved.vehicleMake && saved.vehicleModel && saved.vehicleColor && saved.operatingArea));
                setForm((current: any) => ({ ...current, firstName: saved.firstName || current.firstName, lastName: saved.lastName || current.lastName, otherNames: saved.otherNames || current.otherNames, dateOfBirth: saved.dateOfBirth ? String(saved.dateOfBirth).slice(0, 10) : current.dateOfBirth, ...splitInternationalPhone(saved.phone || composeInternationalPhone(current.phoneCountryCode, current.phoneNationalNumber)), homeAddress: saved.homeAddress || current.homeAddress, tricycle: saved.tricycle || current.tricycle, vehicleMake: saved.vehicleMake || current.vehicleMake, vehicleModel: saved.vehicleModel || current.vehicleModel, vehicleColor: saved.vehicleColor || current.vehicleColor, operatingState: saved.operatingState || 'Ebonyi', operatingArea: saved.operatingArea || current.operatingArea }));
            }
            setDocuments(Array.isArray(result.data?.documents) ? result.data.documents : []);
        } catch { /* keep the editable onboarding form available */ }
    };
    useEffect(() => { void loadVerification(); }, [driver.id]);

    const useCurrentLocationForHome = () => {
        if (!navigator.geolocation) { notify('Location is not available in this browser. Enter your home address manually.'); return; }
        setLocatingHome(true);
        navigator.geolocation.getCurrentPosition(async position => {
            try {
                const point: GeoPoint = { lat: position.coords.latitude, lng: position.coords.longitude };
                const address = await reverseGeocode(point);
                if (address) {
                    setForm((current: any) => ({ ...current, homeAddress: address }));
                    setProfileSaved(false);
                    notify('Current location added as your home address. Please check it before saving.');
                } else {
                    notify('We could not turn your current location into an address. Please enter it manually.');
                }
            } catch { notify('Address lookup failed. Please enter your home address manually.'); }
            finally { setLocatingHome(false); }
        }, error => {
            const message = error.code === 1 ? 'Location permission was denied.' : error.code === 3 ? 'Location lookup timed out.' : 'Your current location is unavailable.';
            notify(message + ' You can enter your home address manually.');
            setLocatingHome(false);
        }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    };

    const saveApplication = async () => {
        const internationalPhone = composeInternationalPhone(form.phoneCountryCode, form.phoneNationalNumber);
        if (!form.homeAddress.trim()) { notify('Enter your home address or use your current location.'); return; }
        if (Boolean(form.emergencyName.trim()) !== Boolean(form.emergencyPhone.trim())) { notify('Enter both emergency contact name and phone, or leave both blank.'); return; }
        if (!form.vehicleMake.trim() || !form.vehicleModel.trim() || !form.vehicleColor.trim() || !form.tricycle.trim() || !form.operatingState.trim() || !form.operatingArea.trim()) { notify('Complete all required vehicle and operating-area details.'); return; }
        if (!/^\+[1-9]\d{7,14}$/.test(internationalPhone)) { notify('Enter a valid phone number and select its country code.'); return; }
        setBusy(true);
        try {
            const { emergencyName, emergencyPhone, phoneCountryCode, phoneNationalNumber, ...driverFields } = form;
            const driverPayload = { ...driverFields, phone: internationalPhone, homeAddress: form.homeAddress.trim() };
            const res = await api.put('/api/driver/me/verification', driverPayload);
            await saveProfile({ ...profile, name: [form.firstName, form.otherNames, form.lastName].filter(Boolean).join(' '), phone: internationalPhone, emergencyName: form.emergencyName.trim(), emergencyPhone: form.emergencyPhone.trim(), role: 'driver' });
            if (res.data?.driver) { setSavedDriver(res.data.driver); setDriverProfile?.(res.data.driver); setProfileSaved(true); notify('Driver details saved. Upload the required documents next.'); }
            await loadVerification();
        } catch (error: any) { notify(error?.message || 'Driver details could not be saved.'); }
        finally { setBusy(false); }
    };

    const uploadDocument = async (documentType: string, file?: File) => {
        if (!file) return;
        if (!consent) { notify('Please read and accept the secure document-processing consent first.'); return; }
        if (file.size > 8 * 1024 * 1024) { notify('Each document must be smaller than 8 MB.'); return; }
        if (!profileSaved || !form.firstName.trim() || !form.lastName.trim() || !form.dateOfBirth || !form.tricycle.trim() || !form.vehicleMake.trim() || !form.vehicleModel.trim() || !form.vehicleColor.trim() || !form.operatingArea.trim()) { notify('Save your personal and vehicle details before uploading documents.'); return; }
        setUploading(documentType);
        try {
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('File could not be read'));
                reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
                reader.readAsDataURL(file);
            });
            const result = await api.post('/api/driver/me/verification/documents', { documentType, fileName: file.name, mimeType: file.type, base64, consent: true });
            setLastChecks(result.data?.checks || null);
            notify(result.data?.message || 'Document uploaded for verification.');
            await loadVerification();
        } catch (error: any) { notify(error?.message || 'Document upload failed.'); }
        finally { setUploading(null); }
    };

    const [requiredDocs, setRequiredDocs] = useState<any[]>([
        { type: 'government_id', label: 'Government-issued ID', hint: 'NIN slip/card or another accepted government ID', accept: 'image/*,application/pdf', required: true },
        { type: 'drivers_license', label: "Driver's licence", hint: 'Upload a clear, unexpired licence belonging to you', accept: 'image/*,application/pdf', required: true },
        { type: 'vehicle_registration', label: 'Tricycle registration', hint: 'The registration number must match the tricycle profile', accept: 'image/*,application/pdf', required: true },
        { type: 'selfie', label: 'Selfie for face match', hint: 'Use a clear, recent photo. A still image alone does not prove liveness; a supported provider is required for that check', accept: 'image/*', required: false },
    ]);
    useEffect(() => {
        let active = true;
        api.get('/api/driver/verification-config?state=' + encodeURIComponent(form.operatingState || 'Ebonyi')).then(result => {
            if (!active || !result.data?.config) return;
            const config = result.data.config;
            setRequiredDocs([...(config.requiredDocuments || []), ...(config.optionalDocuments || [])]);
        }).catch(() => { });
        return () => { active = false; };
    }, [form.operatingState]);
    const statusLabel = (status: string) => ({ verified: 'Verified', checks_passed: 'Automated checks passed', uploaded: 'Uploaded', needs_review: 'Needs review', rejected: 'Rejected', expired: 'Expired', pending: 'Not submitted' } as Record<string, string>)[status] || status.replace(/_/g, ' ');
    const statusClass = (status: string) => ['verified', 'checks_passed'].includes(status) ? 'verified' : ['rejected', 'expired'].includes(status) ? 'rejected' : 'pending';

    return <div className="mobile-frame driver-onboarding-page"><section className="screen-head"><button className="back-button" aria-label="Back to driver home" onClick={() => setTab('home')}>←</button><div><div className="eyebrow">DRIVER ONBOARDING</div><h2>Driver verification</h2></div></section>
        <div className="booking-intro"><div className="booking-intro-icon"><ShieldCheck size={20} /></div><div><strong>Use your own valid documents</strong><span>Make sure the name and date of birth match your profile. Upload clear, complete, unexpired documents. Blurry, cropped or mismatched documents may need to be resubmitted.</span></div></div>
        <div className="form-card driver-verification-form">
            <h3>Personal details</h3>
            <div className="verification-form-grid"><label>First name <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="given-name" value={form.firstName} onChange={e => { setForm({ ...form, firstName: e.target.value }); setProfileSaved(false) }} placeholder="First name on your ID" /></label><label>Last name <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="family-name" value={form.lastName} onChange={e => { setForm({ ...form, lastName: e.target.value }); setProfileSaved(false) }} placeholder="Last name on your ID" /></label></div>
            <label>Other names (optional)<input value={form.otherNames} onChange={e => { setForm({ ...form, otherNames: e.target.value }); setProfileSaved(false) }} placeholder="Middle name or additional names" /></label>
            <label>Date of birth <span className="required-indicator">(required)</span><input required aria-required="true" type="date" autoComplete="bday" value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={e => { setForm({ ...form, dateOfBirth: e.target.value }); setProfileSaved(false) }} /></label>
            <div className="driver-phone-fields"><label>Country code <span className="required-indicator">(required)</span><select required aria-required="true" autoComplete="tel-country-code" value={form.phoneCountryCode} onChange={e => { setForm({ ...form, phoneCountryCode: e.target.value }); setProfileSaved(false) }}>{PHONE_COUNTRY_CODES.map(country => <option key={country.value} value={country.value}>{country.label}</option>)}</select></label><label>Phone number <span className="required-indicator">(required)</span><input required aria-required="true" type="tel" inputMode="tel" autoComplete="tel-national" aria-describedby="driver-phone-help" value={form.phoneNationalNumber} onChange={e => { setForm({ ...form, phoneNationalNumber: e.target.value }); setProfileSaved(false) }} placeholder="8031234567" /></label></div><small id="driver-phone-help" className="phone-format-hint">Enter the number without the country code. We save it in international format, for example +2348031234567.</small>
            <label>Home address <span className="required-indicator">(required)</span><textarea required aria-required="true" aria-describedby="home-address-help" autoComplete="street-address" rows={2} value={form.homeAddress} onChange={e => { setForm({ ...form, homeAddress: e.target.value }); setProfileSaved(false) }} placeholder="House number, street, area, city" /></label>
            <button type="button" className="secondary-button full" aria-describedby="home-address-help" aria-busy={locatingHome} disabled={locatingHome} onClick={useCurrentLocationForHome}><Navigation size={16} />{locatingHome ? 'Finding your location…' : 'Use my current location as home address'}</button>
            <small id="home-address-help" className="phone-format-hint">Your device location is used to look up an address. Check the result before saving. Your home address is for account and verification purposes, not for display to passengers.</small>
            <h3 className="driver-subsection-heading">Emergency contact</h3>
            <p className="muted">Choose someone Tridash can contact in a genuine safety emergency. These details are kept private.</p>
            <div className="verification-form-grid"><label>Contact name (optional)<input autoComplete="off" value={form.emergencyName} onChange={e => { setForm({ ...form, emergencyName: e.target.value }); setProfileSaved(false) }} placeholder="Full name" /></label><label>Contact phone (optional)<input type="tel" inputMode="tel" autoComplete="off" value={form.emergencyPhone} onChange={e => { setForm({ ...form, emergencyPhone: e.target.value }); setProfileSaved(false) }} placeholder="Phone number" /></label></div>
        </div>
        <div className="form-card driver-verification-form">
            <h3>Vehicle details</h3>
            <div className="verification-form-grid"><label>Vehicle make / manufacturer <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="off" value={form.vehicleMake} onChange={e => { setForm({ ...form, vehicleMake: e.target.value }); setProfileSaved(false) }} placeholder="e.g. Bajaj" /></label><label>Vehicle model <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="off" value={form.vehicleModel} onChange={e => { setForm({ ...form, vehicleModel: e.target.value }); setProfileSaved(false) }} placeholder="Model / variant" /></label></div>
            <label>Vehicle colour <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="off" value={form.vehicleColor} onChange={e => { setForm({ ...form, vehicleColor: e.target.value }); setProfileSaved(false) }} placeholder="e.g. yellow and black" /></label>
            <label>Tricycle registration number <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="off" value={form.tricycle} onChange={e => { setForm({ ...form, tricycle: e.target.value.toUpperCase() }); setProfileSaved(false) }} placeholder="EB-123-XY" /></label>
            <label>Operating state <span className="required-indicator">(required)</span><select required aria-required="true" value={form.operatingState} onChange={e => { setForm({ ...form, operatingState: e.target.value }); setProfileSaved(false) }}><option>Ebonyi</option><option>Abia</option><option>Anambra</option><option>Enugu</option><option>Imo</option><option>Rivers</option><option>Cross River</option><option>Akwa Ibom</option><option>Other</option></select></label>
            <label>Primary operating area / city or LGA <span className="required-indicator">(required)</span><input required aria-required="true" autoComplete="address-level2" value={form.operatingArea} onChange={e => { setForm({ ...form, operatingArea: e.target.value }); setProfileSaved(false) }} placeholder="e.g. Abakaliki, Ebonyi LGA" /></label>
            <small className="phone-format-hint">Your assigned passenger can see your vehicle make, model, colour and registration to identify the tricycle. Your home address, date of birth, ID documents and emergency contact remain private.</small>
            <button type="button" className="primary-button full" aria-busy={busy} disabled={busy} onClick={saveApplication}>{busy ? 'Saving details…' : 'Save personal and vehicle details'}</button>
        </div>
        <div className="form-card driver-document-list"><h3>Required documents</h3><p className="muted">Accepted formats: JPG, PNG, WebP or PDF. Maximum 8 MB per file. We run automated checks where supported; official verification is only marked complete when an authorised service or an admin review confirms it.</p>
            {requiredDocs.map(doc => { const uploaded = documents.find(item => item.documentType === doc.type); return <div className="driver-upload-row" key={doc.type}><div className="driver-upload-heading"><div><strong>{doc.label} {doc.required ? '*' : '(optional)'}</strong><small>{doc.hint}</small></div><span className={'verification-state ' + statusClass(uploaded?.status || 'pending')}>{statusLabel(uploaded?.status || 'pending')}</span></div>{uploaded && <div className="driver-upload-meta"><span>{uploaded.originalName}</span>{uploaded.expiryDate && <span>Expiry: {new Date(uploaded.expiryDate).toLocaleDateString()}</span>}{uploaded.reviewReason && <small>{uploaded.reviewReason}</small>}</div>}<label className="upload-file-control">{uploading === doc.type ? 'Processing upload…' : uploaded ? 'Replace document' : 'Choose file'}<input type="file" accept={doc.accept} disabled={!!uploading} onChange={e => { void uploadDocument(doc.type, e.target.files?.[0]); e.currentTarget.value = ''; }} /></label></div>; })}
            <label className="verification-consent"><input type="checkbox" required aria-required="true" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I consent to Tridash securely processing these documents for identity, driving-licence, vehicle and fraud checks, including face matching and liveness checks if enabled. I understand a provider may be used only where configured and authorised.</span></label>
            {lastChecks && <div className="verification-check-results"><strong>Latest automated check</strong>{Object.entries(lastChecks).filter(([key]) => !['notes'].includes(key)).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</span><b>{value === true ? 'Passed' : value === false ? 'Failed' : value === null ? 'Not confirmed' : String(value)}</b></div>)}{Array.isArray(lastChecks.notes) && lastChecks.notes.map((note: string, i: number) => <small key={i}>{note}</small>)}</div>}
        </div>
        <div className="verification-card"><div className="verified-badge"><ShieldCheck size={19} /></div><div><span className="eyebrow">APPLICATION STATUS</span><strong>{savedDriver.verified ? 'Verified driver' : statusLabel(savedDriver.verificationStatus || 'incomplete')}</strong><p>{savedDriver.verified ? 'Your driver account is approved.' : 'You cannot go online or accept rides until the required documents are verified and your application is approved.'}</p></div></div>
        <PayoutAccountSection driver={driver} notify={notify} />
    </div>;
}

type BankLogoEntry = {
    name: string;
    aliases?: string[];
    bankCode?: string;
    scCode?: string;
    logos?: { svg?: string; png?: string };
};

const BANK_LOGO_INDEX_URL = 'https://cdn.jsdelivr.net/gh/Nigerian-Bank-Logos/ng-bank-logos@main/dist/banks_NGN.json';
const BANK_LOGO_FALLBACK_URL = 'https://cdn.jsdelivr.net/gh/Nigerian-Bank-Logos/ng-bank-logos@main/logos/_default.svg';
let bankLogoIndexRequest: Promise<BankLogoEntry[]> | null = null;

function loadBankLogoIndex(): Promise<BankLogoEntry[]> {
    if (!bankLogoIndexRequest) {
        bankLogoIndexRequest = fetch(BANK_LOGO_INDEX_URL)
            .then(response => {
                if (!response.ok) throw new Error('Could not load bank logos');
                return response.json();
            })
            .then(payload => Array.isArray(payload?.banks) ? payload.banks as BankLogoEntry[] : [])
            .catch(() => {
                bankLogoIndexRequest = null;
                return [];
            });
    }
    return bankLogoIndexRequest;
}

function normalizeBankLabel(value: string): string {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function findBankLogo(name: string, code: string, entries: BankLogoEntry[]): string | null {
    const targetName = normalizeBankLabel(name);
    const targetCode = String(code || '').trim();
    const digitsOnly = (value: string) => value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const codeMatch = entries.find(entry => {
        const candidates = [entry.bankCode, entry.scCode].filter(Boolean) as string[];
        return targetCode && candidates.some(candidate => candidate === targetCode || digitsOnly(candidate) === digitsOnly(targetCode));
    });
    const nameMatch = codeMatch || entries.find(entry => {
        const labels = [entry.name, ...(entry.aliases || [])].map(normalizeBankLabel);
        return labels.some(label => label === targetName);
    }) || entries.find(entry => {
        const labels = [entry.name, ...(entry.aliases || [])].map(normalizeBankLabel);
        return labels.some(label => label.length > 4 && (targetName.includes(label) || label.includes(targetName)));
    });
    return nameMatch?.logos?.svg || nameMatch?.logos?.png || null;
}

function BankLogo({ name, code = '', size = 'normal' }: { name: string; code?: string; size?: 'normal' | 'large' }) {
    const [logoUrl, setLogoUrl] = useState(BANK_LOGO_FALLBACK_URL);
    const [fallbackFailed, setFallbackFailed] = useState(false);

    useEffect(() => {
        let active = true;
        setLogoUrl(BANK_LOGO_FALLBACK_URL);
        setFallbackFailed(false);
        void loadBankLogoIndex().then(entries => {
            if (!active) return;
            const match = findBankLogo(name, code, entries);
            if (match) setLogoUrl(match);
        });
        return () => { active = false; };
    }, [name, code]);

    const handleLogoError = () => {
        if (logoUrl !== BANK_LOGO_FALLBACK_URL) setLogoUrl(BANK_LOGO_FALLBACK_URL);
        else setFallbackFailed(true);
    };

    return <span className={`bank-logo ${size === 'large' ? 'bank-logo-large' : ''}`} aria-hidden="true">
        {!fallbackFailed
            ? <img src={logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={handleLogoError} />
            : <Landmark aria-hidden="true" />}
    </span>;
}

function PayoutAccountSection({ driver, notify }: any) {
    const [banks, setBanks] = useState<{ name: string; code: string }[]>([]);
    const [banksLoading, setBanksLoading] = useState(true);
    const [banksError, setBanksError] = useState('');
    const [banksStale, setBanksStale] = useState(false);
    const [bankCode, setBankCode] = useState(driver.payoutBankCode || '');
    const [bankSearch, setBankSearch] = useState('');
    const [bankPickerOpen, setBankPickerOpen] = useState(false);
    const [accountNumber, setAccountNumber] = useState(driver.payoutAccountNumber || '');
    const [accountName, setAccountName] = useState(driver.payoutAccountName || '');
    const [busy, setBusy] = useState<'resolve' | 'save' | null>(null);
    const [persisted, setPersisted] = useState({
        bankCode: driver.payoutBankCode || '',
        accountNumber: driver.payoutAccountNumber || '',
        accountName: driver.payoutAccountName || '',
        subaccountCode: driver.payoutSubaccountCode || '',
    });
    const normalizedAccountNumber = accountNumber.replace(/\s+/g, '');
    const saved = Boolean(persisted.subaccountCode);
    const alreadySaved = saved && bankCode === persisted.bankCode && normalizedAccountNumber === persisted.accountNumber;
    const selectedBank = banks.find(bank => bank.code === bankCode);
    const filteredBanks = useMemo(() => {
        const query = bankSearch.trim().toLocaleLowerCase();
        if (!query) return banks;
        return banks.filter(bank => bank.name.toLocaleLowerCase().includes(query) || bank.code.toLocaleLowerCase().includes(query));
    }, [banks, bankSearch]);

    const loadBanks = useCallback(async () => {
        setBanksLoading(true);
        setBanksError('');
        try {
            const res = await api.get('/api/payments/banks');
            const loadedBanks = Array.isArray(res.data?.banks) ? res.data.banks : [];
            if (!loadedBanks.length) throw new Error('No banks are available right now. Please retry.');
            setBanks(loadedBanks);
            setBanksStale(Boolean(res.data?.stale));
        } catch (error: any) {
            setBanksError(error?.message || 'Could not load banks. Check your connection and try again.');
        } finally {
            setBanksLoading(false);
        }
    }, []);

    useEffect(() => { void loadBanks(); }, [loadBanks]);

    const resolveAccount = async () => {
        if (!/^\d{10}$/.test(normalizedAccountNumber) || !bankCode) {
            notify('Enter a 10-digit account number and select a bank.');
            return;
        }
        const accountToVerify = normalizedAccountNumber;
        const bankToVerify = bankCode;
        setBankPickerOpen(false);
        setBusy('resolve');
        setAccountName('');
        try {
            const res = await api.post('/api/payments/banks/resolve', { accountNumber: accountToVerify, bankCode: bankToVerify });
            if (res.data?.accountName) {
                setAccountName(res.data.accountName);
                notify('Account confirmed. Review the name before saving.');
            } else {
                notify('Paystack could not confirm the account name. Check the details.');
            }
        } catch (error: any) {
            notify(error?.message || 'Could not verify that bank account');
        } finally {
            setBusy(null);
        }
    };

    const saveAccount = async () => {
        if (!accountName || !/^\d{10}$/.test(normalizedAccountNumber) || !bankCode) {
            notify('Select a bank and verify the 10-digit account number first.');
            return;
        }
        const accountToSave = normalizedAccountNumber;
        const bankToSave = bankCode;
        const accountNameToSave = accountName;
        const bankNameToSave = selectedBank?.name || (persisted.bankCode === bankCode ? driver.payoutBankName || '' : '');
        setBusy('save');
        try {
            const res = await api.put('/api/driver/me/payout-account', {
                accountNumber: accountToSave,
                bankCode: bankToSave,
                bankName: bankNameToSave,
                accountName: accountNameToSave,
            });
            const savedDriver = res.data?.driver;
            setAccountName(savedDriver?.payoutAccountName || accountNameToSave);
            setPersisted({
                bankCode: bankToSave,
                accountNumber: accountToSave,
                accountName: savedDriver?.payoutAccountName || accountNameToSave,
                subaccountCode: savedDriver?.payoutSubaccountCode || 'saved',
            });
            notify('Payout account saved. Paystack will split paid fares according to the configured commission.');
        } catch (error: any) {
            notify(error?.message || 'Could not save the payout account');
        } finally {
            setBusy(null);
        }
    };

    const maskAccount = (value: string) => value ? `••••••${value.replace(/\s+/g, '').slice(-4)}` : '';

    return <section className="form-card payout-card">
        <div className="payout-card-heading"><div className="payout-icon"><CreditCard size={19} /></div><div><span className="eyebrow">DRIVER EARNINGS</span><h3>Payout bank account</h3></div></div>
        <p className="muted payout-intro">Choose where your share of completed, paid trips should settle. Your account name is checked before saving.</p>

        {saved && persisted.accountNumber && <div className="payout-saved-summary"><div className="payout-saved-icon"><CheckCircle2 size={17} /></div><div className="payout-saved-copy"><strong>Saved payout account</strong><span>{(selectedBank?.name && bankCode === persisted.bankCode ? selectedBank.name : driver.payoutBankName || 'Bank account')} · {maskAccount(persisted.accountNumber)}</span><small>Account name: {persisted.accountName || driver.payoutAccountName}</small></div><span className="payout-saved-status">Saved</span></div>}

        <div className="payout-form-section">
            <label className="payout-field-label">Bank</label>
            <div className="bank-picker">
                <button type="button" className={`bank-picker-trigger ${bankPickerOpen ? 'is-open' : ''}`} onClick={() => { setBankPickerOpen(open => !open); setBankSearch(''); }} aria-expanded={bankPickerOpen} aria-haspopup="listbox" disabled={busy !== null || (banksLoading && banks.length === 0)}>
                    <span className="bank-picker-selected"><BankLogo name={selectedBank?.name || (bankCode ? (driver.payoutBankName || 'Previously saved bank') : 'Choose a bank')} code={bankCode} size="large" /><span><strong>{selectedBank?.name || (bankCode ? (driver.payoutBankName || 'Previously saved bank') : 'Select your bank')}</strong><small>{selectedBank ? `Bank code ${selectedBank.code}` : banksLoading ? 'Loading banks…' : 'Search by bank name or code'}</small></span></span>
                    <ChevronDown size={18} />
                </button>
                {bankPickerOpen && <div className="bank-picker-menu" role="listbox" aria-label="Nigerian banks">
                    <div className="bank-picker-search"><Search size={16} /><input autoFocus disabled={busy !== null} value={bankSearch} onChange={e => setBankSearch(e.target.value)} placeholder="Search bank name or code" aria-label="Search bank name or code" /></div>
                    {banksLoading && <div className="bank-picker-message"><RefreshCw size={15} className="spin" /> Loading banks…</div>}
                    {!banksLoading && banksError && <div className="bank-picker-message bank-picker-error">{banksError}<button type="button" className="text-button-inline" onClick={() => void loadBanks()}>Retry</button></div>}
                    {!banksLoading && !banksError && filteredBanks.length === 0 && <div className="bank-picker-message">No banks match “{bankSearch}”. Try another name.</div>}
                    {!banksLoading && !banksError && filteredBanks.length > 0 && <div className="bank-picker-options">{filteredBanks.map(bank => <button type="button" role="option" aria-selected={bank.code === bankCode} key={bank.code} className={`bank-option ${bank.code === bankCode ? 'selected' : ''}`} disabled={busy !== null} onClick={() => { setBankCode(bank.code); setAccountName(''); setBankPickerOpen(false); setBankSearch(''); }}><BankLogo name={bank.name} code={bank.code} /><span className="bank-option-copy">{bank.name}<small>Bank code {bank.code}</small></span>{bank.code === bankCode && <Check size={16} />}</button>)}</div>}
                    <div className="bank-picker-footer">{banks.length ? `${banks.length} banks available` : 'Bank list unavailable'}{banksStale ? ' · showing last available list' : ''}</div>
                </div>}
            </div>
            {banksLoading && banks.length === 0 && <p className="payout-help">Connecting securely…</p>}
            {banksError && banks.length === 0 && <div className="payout-inline-error"><AlertTriangle size={16} /><span>{banksError}</span><button type="button" className="text-button-inline" onClick={() => void loadBanks()}>Retry</button></div>}
            {banksStale && banks.length > 0 && <p className="payout-help">Connection temporarily unavailable. Showing the most recently loaded bank list.</p>}
        </div>

        <div className="payout-account-label-row"><label className="payout-field-label" htmlFor="payout-account-number">Account number</label><span className="payout-field-hint">10 digits</span></div>
        <div className="payout-account-input-wrap"><CreditCard size={18} /><input id="payout-account-number" className="payout-account-input" value={accountNumber} disabled={busy !== null} onChange={e => { setAccountNumber(e.target.value.replace(/[^\d\s]/g, '').slice(0, 12)); setAccountName(''); }} placeholder="Enter 10-digit account number" inputMode="numeric" autoComplete="off" maxLength={12} aria-describedby="payout-account-hint" /></div>
        <p className="payout-help" id="payout-account-hint">Use the account number registered with your bank. Account verification is required before saving.</p>
        {accountName && <div className="payout-account-confirm"><div className="verified-badge"><ShieldCheck size={18} /></div><div><span className="eyebrow">PAYSTACK VERIFIED ACCOUNT NAME</span><strong>{accountName}</strong><p>Please confirm this is your intended payout account before saving.</p></div></div>}

        <div className="payout-actions"><button className="secondary-button full" disabled={busy !== null || banksLoading || !bankCode || !/^\d{10}$/.test(normalizedAccountNumber)} onClick={resolveAccount}>{busy === 'resolve' ? <><RefreshCw size={16} className="spin" /> Checking account…</> : <><ShieldCheck size={16} /> Verify account</>}</button><button className="primary-button full" disabled={busy !== null || !accountName || !/^\d{10}$/.test(normalizedAccountNumber) || !bankCode || alreadySaved} onClick={saveAccount}>{busy === 'save' ? <><RefreshCw size={16} className="spin" /> Saving…</> : saved ? 'Update payout account' : 'Save payout account'}</button></div>
        <p className="payout-security-note"><ShieldCheck size={14} /> Your account details are sent to Paystack for verification and are not shown on public driver listings.</p>
    </section>;
}

function ActiveDriverRide({ ride, updateRide, notify, driverLocation }: any) {
    // Navigate to the pickup while the trip is still Accepted, then switch to the
    // destination once the passenger is on board.
    const navigatingToPickup = ride.status === 'Accepted';
    const directionsUrl = googleMapsDirectionsUrl(
        navigatingToPickup ? driverLocation : ride.pickupCoords,
        navigatingToPickup ? ride.pickupCoords : ride.destinationCoords,
        navigatingToPickup ? 'Your location' : ride.pickup,
        navigatingToPickup ? ride.pickup : ride.destination
    );
    return <div className="driver-active"><div className="status-card"><div className="status-icon"><Navigation size={24} /></div><div><strong>{ride.status}</strong><p>{ride.pickup} → {ride.destination}</p></div></div><MapView pickup={ride.pickupCoords} destination={ride.destinationCoords} userLocation={driverLocation} driverLocation={driverLocation} followDriver /><div className="passenger-card"><div className="avatar">{String(ride.passenger || 'PA').slice(0, 2).toUpperCase()}</div><div><strong>{ride.passenger}</strong><span>Passenger · emergency support available</span></div>{ride.passengerPhone ? <a className="call-button" href={'tel:' + ride.passengerPhone} aria-label={'Call ' + ride.passenger}><Phone size={17} /></a> : <button className="call-button" aria-label="Passenger phone unavailable" onClick={() => notify('Passenger phone number is not available')}><Phone size={17} /></button>}</div><div className="safety-row"><button onClick={() => notify('Passenger safety contact opened')}><ShieldAlert size={18} /> Safety</button>{directionsUrl ? <a className="safety-link" href={directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={18} /> {navigatingToPickup ? 'Navigate to pickup' : 'Navigate to drop-off'}</a> : <button onClick={() => notify('This trip has no navigation details yet')}><Navigation size={18} /> Navigate</button>}</div>{ride.status === 'Accepted' && <button className="primary-button full" onClick={() => updateRide(ride, 'In Progress', ride.driver || undefined, ride.driverId)}>Start trip</button>}{ride.status === 'In Progress' && <button className="primary-button full" onClick={() => updateRide(ride, 'Completed', ride.driver || undefined, ride.driverId)}>Complete trip</button>}</div>;
}

function AdminWorkspace({ drivers, rides, approveDriver, notify, updateUserRole, suspendUser, askConfirm, initialSection = 'overview' }: any) {
    const navigate = useNavigate();
    const location = useLocation();
    const [section, setSection] = useState(initialSection);
    const [search, setSearch] = useState('');
    const [rideFilter, setRideFilter] = useState('all');
    const [reportText, setReportText] = useState('');
    const [users, setUsers] = useState<any[]>([]);
    const [incidents, setIncidents] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [verificationApplications, setVerificationApplications] = useState<any[]>([]);
    const [adminLoading, setAdminLoading] = useState(true);
    const [adminDataWarning, setAdminDataWarning] = useState('');

    useEffect(() => {
        setSection(initialSection);
    }, [initialSection]);

    const changeSection = (next: string) => {
        setSection(next);
        setSearch('');
        setRideFilter('all');
        navigateFromRoot(navigate, location.pathname, next === 'overview' ? 'admin' : 'admin/' + next);
    };

    const loadAdminData = async () => {
        setAdminLoading(true);
        try {
            const results = await Promise.allSettled([
                api.get('/api/admin/users'),
                api.get('/api/admin/incidents'),
                api.get('/api/admin/payments'),
                api.get('/api/admin/driver-verifications')
            ]);
            const [usersResult, incidentsResult, paymentsResult, verificationResult] = results;
            const failures = results.flatMap((result, index) => result.status === 'rejected'
                ? [['users', 'incidents', 'payments', 'driver verification'][index]]
                : []);
            setUsers(usersResult.status === 'fulfilled' ? usersResult.value.data?.users || [] : []);
            setIncidents(incidentsResult.status === 'fulfilled' ? incidentsResult.value.data?.incidents || [] : []);
            setPayments(paymentsResult.status === 'fulfilled' ? paymentsResult.value.data?.payments || [] : []);
            setVerificationApplications(verificationResult.status === 'fulfilled' ? verificationResult.value.data?.applications || [] : []);
            setAdminDataWarning(failures.length
                ? `Some data sources could not be loaded: ${failures.join(', ')}. Dashboard figures may be incomplete.`
                : '');
        } catch {
            setAdminDataWarning('Administrator data could not be refreshed. Dashboard figures may be incomplete.');
            notify('Administrator data could not be refreshed.');
        } finally {
            setAdminLoading(false);
        }
    };

    useEffect(() => {
        void loadAdminData();
    }, [section]);

    const normalizedSearch = search.trim().toLowerCase();
    const activeRides = rides.filter((ride: Ride) => !['Completed', 'Cancelled'].includes(ride.status));
    const completedRides = rides.filter((ride: Ride) => ride.status === 'Completed');
    const passengerCount = users.filter(user => user.role === 'passenger').length;
    const driverCount = drivers.length;
    const verifiedDriverCount = drivers.filter((driver: Driver) => driver.verified).length;
    const pendingApplications = verificationApplications.filter((application: any) => (
        !application.verified && !['approved', 'verified', 'rejected'].includes(String(application.verificationStatus || '').toLowerCase())
    ));
    const openIncidentCount = incidents.filter((incident: any) => (
        !['resolved', 'closed'].includes(String(incident.status || '').toLowerCase())
    )).length;
    const paidPayments = payments.filter((payment: any) => (
        ['paid', 'success', 'successful'].includes(String(payment.status || '').toLowerCase())
    ));
    const paidPaymentValue = paidPayments.reduce((total: number, payment: any) => total + Number(payment.amount || 0), 0);

    const filteredUsers = users.filter((user: any) => (
        !normalizedSearch || JSON.stringify(user).toLowerCase().includes(normalizedSearch)
    ));
    const filteredApplications = verificationApplications.filter((application: any) => (
        !normalizedSearch || JSON.stringify(application).toLowerCase().includes(normalizedSearch)
    ));
    const filteredDrivers = drivers.filter((driver: Driver) => (
        !normalizedSearch || `${driver.name} ${driver.phone} ${driver.tricycle}`.toLowerCase().includes(normalizedSearch)
    ));
    const filteredRides = rides.filter((ride: Ride) => {
        const matchesSearch = !normalizedSearch || JSON.stringify(ride).toLowerCase().includes(normalizedSearch);
        const matchesStatus = rideFilter === 'all' || ride.status.toLowerCase() === rideFilter;
        return matchesSearch && matchesStatus;
    });
    const filteredIncidents = incidents.filter((incident: any) => (
        !normalizedSearch || JSON.stringify(incident).toLowerCase().includes(normalizedSearch)
    ));
    const filteredPayments = payments.filter((payment: any) => (
        !normalizedSearch || JSON.stringify(payment).toLowerCase().includes(normalizedSearch)
    ));

    const sectionTitles: Record<string, string> = {
        overview: 'Overview',
        users: 'User management',
        drivers: 'Driver management',
        rides: 'Ride monitoring',
        reports: 'Reports & incidents',
        payments: 'Payment records',
        settings: 'Platform settings'
    };
    const sectionDescriptions: Record<string, string> = {
        overview: 'A live view of passenger activity, driver verification and ride operations.',
        users: 'Review registered accounts, account status and workspace permissions.',
        drivers: 'Review submitted documents and manage the registered driver directory.',
        rides: 'Monitor requested, accepted, active, completed and cancelled journeys.',
        reports: 'Review safety reports and record operational incidents.',
        payments: 'Review payment records and amounts confirmed by the payment workflow.',
        settings: 'Review platform controls and operational configuration.'
    };
    const navigationItems = [
        { key: 'overview', label: 'Overview', icon: Home },
        { key: 'users', label: 'Users', icon: Users },
        { key: 'drivers', label: 'Drivers', icon: ShieldCheck },
        { key: 'rides', label: 'Rides', icon: Activity },
        { key: 'reports', label: 'Reports', icon: MessageSquareWarning },
        { key: 'payments', label: 'Payments', icon: CreditCard },
        { key: 'settings', label: 'Settings', icon: Settings }
    ];

    return (
        <div className="admin-layout admin-workspace-v2">
            <aside className="admin-side">
                <div className="admin-brand-lockup">
                    <span className="brand-mark"><Zap size={18} aria-hidden="true" /></span>
                    <span>tridash</span>
                </div>
                <div className="admin-side-label">OPERATIONS WORKSPACE</div>
                <nav className="admin-side-nav" aria-label="Administrator navigation">
                    {navigationItems.map(({ key, label, icon: Icon }) => (
                        <button
                            key={key}
                            type="button"
                            className={section === key ? 'side-active' : ''}
                            aria-current={section === key ? 'page' : undefined}
                            onClick={() => changeSection(key)}
                        >
                            <Icon size={17} aria-hidden="true" />
                            <span>{label}</span>
                            {key === 'drivers' && pendingApplications.length > 0 && (
                                <span className="admin-nav-count">{pendingApplications.length}</span>
                            )}
                        </button>
                    ))}
                </nav>
                <div className="admin-side-footer">
                    <span className="admin-side-footer-icon"><ShieldCheck size={17} aria-hidden="true" /></span>
                    <div>
                        <strong>Protected workspace</strong>
                        <small>Administrator access</small>
                    </div>
                </div>
            </aside>

            <section className="admin-content admin-content-v2">
                <div className="admin-mobile-nav">
                    <select aria-label="Admin section" value={section} onChange={event => changeSection(event.target.value)}>
                        {navigationItems.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select>
                </div>

                <div className="admin-toolbar">
                    <div className="admin-breadcrumb">
                        <span>TRIDASH</span>
                        <ChevronRight size={14} aria-hidden="true" />
                        <strong>OPERATIONS</strong>
                    </div>
                    <div className="admin-toolbar-actions">
                        <span className="admin-sync-indicator"><span /> Data workspace</span>
                        <button className="admin-refresh-button" type="button" disabled={adminLoading} onClick={() => { void loadAdminData(); }}>
                            <RefreshCw size={15} aria-hidden="true" className={adminLoading ? 'is-spinning' : ''} />
                            {adminLoading ? 'Refreshing' : 'Refresh data'}
                        </button>
                    </div>
                </div>

                <header className="admin-page-heading">
                    <div>
                        <span className="admin-page-kicker">ADMINISTRATOR CONSOLE</span>
                        <h1>{sectionTitles[section] || 'Operations'}</h1>
                        <p>{sectionDescriptions[section] || 'Manage Tridash platform operations.'}</p>
                    </div>
                    <div className="admin-page-date">
                        <span>WORKSPACE</span>
                        <strong>Operations</strong>
                    </div>
                </header>

                {adminDataWarning && <div className="admin-data-warning" role="alert"><AlertTriangle size={17} aria-hidden="true" /><span>{adminDataWarning}</span><button type="button" onClick={() => { void loadAdminData(); }}>Retry</button></div>}

                {section === 'overview' && (
                    <div className="admin-overview">
                        <section className="admin-overview-banner">
                            <div className="admin-overview-banner-copy">
                                <span>OPERATIONS SNAPSHOT</span>
                                <h2>Keep every journey moving.</h2>
                                <p>Monitor the network, review driver applications and stay informed about current ride activity.</p>
                                <div className="admin-overview-actions">
                                    <button type="button" onClick={() => changeSection('drivers')}>Review drivers <ChevronRight size={16} aria-hidden="true" /></button>
                                    <button type="button" onClick={() => changeSection('rides')}>Monitor rides <ChevronRight size={16} aria-hidden="true" /></button>
                                </div>
                            </div>
                            <div className="admin-overview-banner-visual" aria-hidden="true">
                                <span className="admin-overview-orbit orbit-one" />
                                <span className="admin-overview-orbit orbit-two" />
                                <span className="admin-overview-route-line" />
                                <span className="admin-overview-route-pin pin-one"><MapPin size={17} /></span>
                                <span className="admin-overview-route-pin pin-two"><CarFront size={18} /></span>
                            </div>
                        </section>

                        <div className="admin-metric-grid">
                            <AdminMetric label="Passengers" value={passengerCount} detail="Registered passenger accounts" icon={Users} tone="green" />
                            <AdminMetric label="Registered drivers" value={driverCount} detail={`${verifiedDriverCount} verified`} icon={CarFront} tone="amber" />
                            <AdminMetric label="Active rides" value={activeRides.length} detail="Requested, accepted or in progress" icon={Activity} tone="navy" />
                            <AdminMetric label="Pending verification" value={pendingApplications.length} detail="Applications awaiting review" icon={FileCheck2} tone="gold" />
                            <AdminMetric label="Completed rides" value={completedRides.length} detail="Successfully completed" icon={CheckCircle2} tone="green" />
                            <AdminMetric label="Open reports" value={openIncidentCount} detail={`${incidents.length} total incident records`} icon={AlertTriangle} tone="rose" />
                        </div>

                        <div className="admin-overview-grid">
                            <Panel title="Driver verification queue" eyebrow="REVIEW REQUIRED" className="admin-overview-panel">
                                <p className="admin-panel-intro">Review submitted documents and record each required check before approving an application.</p>
                                {adminLoading ? (
                                    <AdminEmptyState title="Loading applications" detail="Retrieving the latest driver verification records." />
                                ) : pendingApplications.length ? (
                                    pendingApplications.slice(0, 3).map((application: any) => (
                                        <DriverVerificationApplication key={application.id} application={application} notify={notify} onRefresh={loadAdminData} />
                                    ))
                                ) : (
                                    <AdminEmptyState title="No pending applications" detail="There are no driver applications awaiting review." />
                                )}
                                {pendingApplications.length > 3 && (
                                    <button className="admin-panel-link" type="button" onClick={() => changeSection('drivers')}>
                                        View all {pendingApplications.length} applications <ChevronRight size={16} aria-hidden="true" />
                                    </button>
                                )}
                            </Panel>

                            <Panel title="Live ride monitor" eyebrow="CURRENT ACTIVITY" className="admin-overview-panel">
                                <div className="admin-panel-toolbar">
                                    <span>{activeRides.length} active ride{activeRides.length === 1 ? '' : 's'}</span>
                                    <button type="button" onClick={() => changeSection('rides')}>View all <ChevronRight size={14} aria-hidden="true" /></button>
                                </div>
                                {activeRides.length ? (
                                    activeRides.slice(0, 6).map((ride: Ride) => <RideAdminRow key={ride.id} ride={ride} />)
                                ) : (
                                    <AdminEmptyState title="No active rides" detail="New and ongoing passenger journeys will appear here." />
                                )}
                                <div className="admin-operations-summary">
                                    <div><span>Completed</span><strong>{completedRides.length}</strong></div>
                                    <div><span>Cancelled</span><strong>{rides.filter((ride: Ride) => ride.status === 'Cancelled').length}</strong></div>
                                    <div><span>Verified drivers</span><strong>{verifiedDriverCount}</strong></div>
                                </div>
                            </Panel>
                        </div>
                    </div>
                )}

                {section === 'users' && (
                    <div className="admin-section-layout">
                        <div className="admin-section-summary-grid">
                            <AdminMetric label="All accounts" value={users.length} detail="Registered platform users" icon={Users} tone="green" />
                            <AdminMetric label="Passengers" value={passengerCount} detail="Passenger workspaces" icon={UserRound} tone="amber" />
                            <AdminMetric label="Drivers" value={users.filter(user => user.role === 'driver').length} detail="Driver workspaces" icon={CarFront} tone="navy" />
                        </div>
                        <Panel title="User directory" eyebrow="ACCOUNT MANAGEMENT" className="admin-section-panel">
                            <div className="admin-list-toolbar">
                                <div className="search-box"><Search size={17} /><input aria-label="Search users" placeholder="Search name, email or role" value={search} onChange={event => setSearch(event.target.value)} /></div>
                                <span>{filteredUsers.length} account{filteredUsers.length === 1 ? '' : 's'}</span>
                            </div>
                            {adminLoading ? <AdminEmptyState title="Loading users" detail="Retrieving registered account records." /> : filteredUsers.length ? filteredUsers.map((user: any) => (
                                <AdminUserRow key={user.id} user={user} updateUserRole={updateUserRole} suspendUser={suspendUser} setUsers={setUsers} askConfirm={askConfirm} />
                            )) : <AdminEmptyState title="No matching users" detail="Try another name, email address or account role." />}
                        </Panel>
                    </div>
                )}

                {section === 'drivers' && (
                    <div className="admin-section-layout">
                        <div className="admin-section-summary-grid">
                            <AdminMetric label="Registered drivers" value={driverCount} detail="Driver profiles" icon={CarFront} tone="green" />
                            <AdminMetric label="Verified drivers" value={verifiedDriverCount} detail="Approved for operations" icon={ShieldCheck} tone="amber" />
                            <AdminMetric label="Awaiting review" value={pendingApplications.length} detail="Verification applications" icon={FileCheck2} tone="navy" />
                        </div>
                        <Panel title="Verification applications" eyebrow="DOCUMENT REVIEW" className="admin-section-panel">
                            <div className="admin-list-toolbar">
                                <div className="search-box"><Search size={17} /><input aria-label="Search verification applications" placeholder="Search by name, phone or operating area" value={search} onChange={event => setSearch(event.target.value)} /></div>
                                <span>{filteredApplications.length} application{filteredApplications.length === 1 ? '' : 's'}</span>
                            </div>
                            {adminLoading ? <AdminEmptyState title="Loading applications" detail="Retrieving submitted verification records." /> : filteredApplications.length ? filteredApplications.map((application: any) => (
                                <DriverVerificationApplication key={application.id} application={application} notify={notify} onRefresh={loadAdminData} />
                            )) : <AdminEmptyState title="No matching applications" detail="No verification applications match this search." />}
                        </Panel>
                        <Panel title="Registered driver directory" eyebrow="DRIVER NETWORK" className="admin-section-panel">
                            <div className="admin-list-toolbar">
                                <div className="search-box"><Search size={17} /><input aria-label="Search registered drivers" placeholder="Search driver name, phone or vehicle" value={search} onChange={event => setSearch(event.target.value)} /></div>
                                <span>{filteredDrivers.length} driver{filteredDrivers.length === 1 ? '' : 's'}</span>
                            </div>
                            {filteredDrivers.length ? filteredDrivers.map((driver: Driver) => (
                                <DriverAdminRow key={driver.id} driver={driver} approve={() => approveDriver(driver)} />
                            )) : <AdminEmptyState title="No matching drivers" detail="Try another name, phone number or vehicle detail." />}
                        </Panel>
                    </div>
                )}

                {section === 'rides' && (
                    <div className="admin-section-layout">
                        <div className="admin-section-summary-grid">
                            <AdminMetric label="All rides" value={rides.length} detail="Recorded ride requests" icon={Activity} tone="green" />
                            <AdminMetric label="Active rides" value={activeRides.length} detail="Currently in the ride lifecycle" icon={Navigation} tone="amber" />
                            <AdminMetric label="Completed rides" value={completedRides.length} detail="Completed journeys" icon={CheckCircle2} tone="navy" />
                        </div>
                        <Panel title="Ride management" eyebrow="TRIP OPERATIONS" className="admin-section-panel">
                            <div className="admin-list-toolbar admin-ride-filters">
                                <div className="search-box"><Search size={17} /><input aria-label="Search rides" placeholder="Search passenger, driver, route or ride ID" value={search} onChange={event => setSearch(event.target.value)} /></div>
                                <select aria-label="Filter rides by status" value={rideFilter} onChange={event => setRideFilter(event.target.value)}>
                                    <option value="all">All statuses</option>
                                    <option value="requested">Requested</option>
                                    <option value="accepted">Accepted</option>
                                    <option value="in progress">In progress</option>
                                    <option value="completed">Completed</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                            </div>
                            <div className="admin-list-result-count">Showing {filteredRides.length} of {rides.length} ride records</div>
                            {filteredRides.length ? filteredRides.map((ride: Ride) => <RideAdminRow key={ride.id} ride={ride} />) : (
                                <AdminEmptyState title="No matching rides" detail="Change the search terms or status filter to see other rides." />
                            )}
                        </Panel>
                    </div>
                )}

                {section === 'reports' && (
                    <div className="admin-section-layout">
                        <div className="admin-section-summary-grid">
                            <AdminMetric label="All reports" value={incidents.length} detail="Incident records received" icon={MessageSquareWarning} tone="green" />
                            <AdminMetric label="Open reports" value={openIncidentCount} detail="Not marked resolved or closed" icon={AlertTriangle} tone="amber" />
                            <AdminMetric label="Resolved / closed" value={incidents.length - openIncidentCount} detail="Records with a closed status" icon={CheckCircle2} tone="navy" />
                        </div>
                        <Panel title="Complaints and incidents" eyebrow="SAFETY QUEUE" className="admin-section-panel">
                            <div className="admin-report-intro"><AlertTriangle size={19} aria-hidden="true" /><div><strong>Incident review</strong><p>Review submitted safety reports and record additional operational incidents.</p></div></div>
                            <form className="admin-report-form" onSubmit={async event => {
                                event.preventDefault();
                                if (!reportText.trim()) return;
                                try {
                                    await api.post('/api/incidents', { type: 'admin-report', message: reportText.trim() });
                                    setReportText('');
                                    await loadAdminData();
                                    notify('Incident recorded');
                                } catch {
                                    notify('Incident could not be recorded');
                                }
                            }}>
                                <label htmlFor="admin-report-details">Record an operational incident</label>
                                <textarea id="admin-report-details" value={reportText} onChange={event => setReportText(event.target.value)} placeholder="Enter the incident details and relevant context…" rows={3} />
                                <button className="primary-button" type="submit" disabled={!reportText.trim() || adminLoading}>Record incident</button>
                            </form>
                            <div className="admin-list-toolbar">
                                <strong>Incident register</strong>
                                <div className="search-box"><Search size={17} /><input aria-label="Search incidents" placeholder="Search incidents" value={search} onChange={event => setSearch(event.target.value)} /></div>
                            </div>
                            {adminLoading ? <AdminEmptyState title="Loading incidents" detail="Retrieving the latest incident records." /> : filteredIncidents.length ? filteredIncidents.map((incident: any) => (
                                <div className="ride-row admin-incident-row" key={incident.id}>
                                    <div><strong>{incident.type || 'Incident'}</strong><span>{incident.message || 'No details supplied'} · {incident.createdAt ? new Date(incident.createdAt).toLocaleString() : 'Date unavailable'}</span></div>
                                    <span className={'ride-status ' + String(incident.severity || incident.status || 'normal').toLowerCase()}>{incident.severity || incident.status || 'Open'}</span>
                                </div>
                            )) : <AdminEmptyState title="No matching incidents" detail="There are no incident records matching this search." />}
                        </Panel>
                    </div>
                )}

                {section === 'payments' && (
                    <div className="admin-section-layout">
                        <div className="admin-section-summary-grid">
                            <AdminMetric label="Payment records" value={payments.length} detail="Transactions returned by the API" icon={CreditCard} tone="green" />
                            <AdminMetric label="Paid records" value={paidPayments.length} detail="Confirmed paid or successful status" icon={CheckCircle2} tone="amber" />
                            <AdminMetric label="Recorded paid value" value={`₦${paidPaymentValue.toLocaleString()}`} detail="Sum of confirmed payment amounts" icon={Landmark} tone="navy" />
                        </div>
                        <Panel title="Payment register" eyebrow="FINANCIAL AUDIT" className="admin-section-panel">
                            <p className="admin-panel-intro">Payment status is displayed from the records returned by the payment service. The amount shown is recorded payment value, not a calculation of driver earnings.</p>
                            <div className="admin-list-toolbar">
                                <div className="search-box"><Search size={17} /><input aria-label="Search payment records" placeholder="Search payment method, ride ID or status" value={search} onChange={event => setSearch(event.target.value)} /></div>
                                <span>{filteredPayments.length} record{filteredPayments.length === 1 ? '' : 's'}</span>
                            </div>
                            {adminLoading ? <AdminEmptyState title="Loading payments" detail="Retrieving payment records." /> : filteredPayments.length ? filteredPayments.map((payment: any) => (
                                <div className="ride-row admin-payment-row" key={payment.id}>
                                    <div><strong>{payment.method || 'Payment'}</strong><span>Ride {payment.rideId || '—'} · {payment.createdAt ? new Date(payment.createdAt).toLocaleString() : 'Date unavailable'}</span></div>
                                    <b>₦{Number(payment.amount || 0).toLocaleString()}</b>
                                    <span className={'ride-status ' + String(payment.status || 'Pending').toLowerCase()}>{payment.status || 'Pending'}</span>
                                </div>
                            )) : <AdminEmptyState title="No payment records" detail="Payment records will appear here when returned by the payment service." />}
                        </Panel>
                    </div>
                )}

                {section === 'settings' && (
                    <div className="admin-section-layout">
                        <Panel title="Platform configuration" eyebrow="SERVICE STATUS" className="admin-section-panel">
                            <div className="admin-settings-list">
                                <div className="settings-row"><Shield size={19} /><div><strong>Safety policy</strong><span>SOS events are stored against trip records.</span></div><CheckCircle2 size={18} /></div>
                                <div className="settings-row"><CreditCard size={19} /><div><strong>Payments</strong><span>Passenger payments use Paystack checkout and server-side verification.</span></div><CheckCircle2 size={18} /></div>
                                <div className="settings-row"><Bell size={19} /><div><strong>Notifications</strong><span>Ride and safety notification delivery is configured through the platform.</span></div><CheckCircle2 size={18} /></div>
                            </div>
                        </Panel>
                        <Panel title="Account administration" eyebrow="PROTECTED ACTIONS" className="admin-section-panel">
                            <div className="danger-panel admin-danger-panel">
                                <div><strong>Reset non-superadmin accounts</strong><span>Delete every Tridash and Firebase account except the protected superadmin account. This action is irreversible.</span></div>
                                <button className="secondary-button danger-button" type="button" onClick={async () => {
                                    const first = await askConfirm('Delete other users?', 'This will delete every Tridash and Firebase account except the protected superadmin account.', 'Delete accounts');
                                    if (!first) return;
                                    const second = await askConfirm('Final confirmation', 'This action cannot be undone. Continue deleting the other accounts?', 'Yes, delete them');
                                    if (!second) return;
                                    try {
                                        const result = await api.post('/api/admin/reset-users');
                                        notify((result.data?.deletedFirebaseUsers || 0) + ' other user account(s) deleted.');
                                        setUsers([]);
                                    } catch (error: any) {
                                        notify(error?.message || 'User reset could not be completed.');
                                    }
                                }}>Delete other users</button>
                            </div>
                        </Panel>
                    </div>
                )}
            </section>
        </div>
    );
}

function AdminMetric({ label, value, detail, icon: Icon, tone }: any) {
    return (
        <article className={`admin-metric-card is-${tone}`}>
            <span className="admin-metric-icon"><Icon size={18} aria-hidden="true" /></span>
            <span className="admin-metric-label">{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
        </article>
    );
}

function AdminEmptyState({ title, detail }: { title: string; detail: string }) {
    return (
        <div className="admin-empty-state">
            <span><Activity size={19} aria-hidden="true" /></span>
            <div><strong>{title}</strong><p>{detail}</p></div>
        </div>
    );
}

function Stat({ label, value, icon: Icon }: any) { return <div className="stat-card"><Icon size={19} /><span>{label}</span><strong>{value}</strong></div> }
function Panel({ title, eyebrow, children, className = '' }: any) { return <section className={`admin-panel ${className}`}><div className="panel-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>{children}</section> }
function AdminUserRow({ user, updateUserRole, suspendUser, setUsers, askConfirm }: any) { const suspended = user.status === 'suspended'; const [saving, setSaving] = useState(false); const changeRole = async (nextRole: Role) => { if (nextRole === user.role) return; const confirmed = await askConfirm('Change account role?', 'Change ' + (user.name || user.email) + ' to ' + nextRole + '? This changes the workspace permissions available to the account.', 'Change role'); if (!confirmed) return; setSaving(true); if (await updateUserRole(user.id, nextRole)) setUsers((x: any[]) => x.map(item => item.id === user.id ? { ...item, role: nextRole } : item)); setSaving(false) }; const toggleStatus = async () => { const nextSuspended = !suspended; if (nextSuspended) { const confirmed = await askConfirm('Suspend account?', 'Suspend ' + (user.name || user.email) + '? They will be blocked from protected Tridash actions.', 'Suspend account'); if (!confirmed) return; } setSaving(true); if (await suspendUser(user.id, nextSuspended)) setUsers((x: any[]) => x.map(item => item.id === user.id ? { ...item, status: nextSuspended ? 'suspended' : 'active' } : item)); setSaving(false) }; return <div className="driver-row user-admin-row"><div className="avatar">{String(user.name || user.email).slice(0, 2).toUpperCase()}</div><div className="driver-info"><strong>{user.name || 'Unnamed user'}</strong><span>{user.email}</span><small className={'user-account-state ' + (suspended ? 'is-suspended' : '')}>{suspended ? 'Suspended account' : user.emailVerified ? 'Verified account' : 'Email not verified'}</small></div>{!user.isSuperAdmin && <div className="user-controls"><div className="user-control"><label>Role</label><select disabled={saving} value={user.role} onChange={e => changeRole(e.target.value as Role)}><option value="passenger">Passenger</option><option value="driver">Driver</option><option value="admin">Admin</option></select></div><div className="user-control"><label>Account</label><button className={'secondary-button compact user-status-button ' + (suspended ? 'reactivate' : 'suspend')} disabled={saving} onClick={toggleStatus}>{saving ? 'Saving…' : suspended ? 'Reactivate' : 'Suspend'}</button></div></div>}{user.isSuperAdmin && <span className="superadmin-badge">Superadmin protected</span>}</div> }
function DriverVerificationApplication({ application, notify, onRefresh }: any) {
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<string | null>(null);
    const name = [application.firstName, application.otherNames, application.lastName].filter(Boolean).join(' ') || application.name || 'Unnamed driver';
    const docs = Array.isArray(application.verificationDocuments) ? application.verificationDocuments : [];
    const requiredTypes = Array.isArray(application.requiredDocumentTypes) ? application.requiredDocumentTypes : ['government_id', 'drivers_license', 'vehicle_registration'];
    const latestRequired = requiredTypes.map((type: string) => docs.find((doc: any) => doc.documentType === type));
    const verifiedRequiredCount = latestRequired.filter((doc: any) => doc?.status === 'verified').length;
    const typeLabel = (type: string) => ({ government_id: 'Government-issued ID', drivers_license: "Driver's licence", vehicle_registration: 'Tricycle registration', selfie: 'Face verification selfie' } as Record<string, string>)[type] || type;
    const statusClass = (status: string) => status === 'verified' ? 'verified' : ['rejected', 'expired'].includes(status) ? 'rejected' : 'pending';
    const review = async (doc: any, status: 'verified' | 'rejected' | 'needs_review') => {
        const note = (notes[doc.id] || '').trim();
        if (status !== 'needs_review' && note.length < 8) { notify('Add a review note or official verification reference (at least 8 characters).'); return; }
        setBusy(doc.id + status);
        try { await api.put(`/api/admin/driver-verifications/${application.id}/documents/${doc.id}`, { status, reviewReason: note }); notify(typeLabel(doc.documentType) + ' review saved.'); await onRefresh(); }
        catch (error: any) { notify(error?.message || 'Could not save document review.'); }
        finally { setBusy(null); }
    };
    const approve = async () => {
        setBusy('approve');
        try { await api.post(`/api/admin/driver-verifications/${application.id}/approve`, {}); notify(name + ' approved.'); await onRefresh(); }
        catch (error: any) { notify(error?.message || 'Driver cannot be approved until all required checks pass.'); }
        finally { setBusy(null); }
    };
    const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
    return <article className="verification-application"><div className="verification-application-head"><div className="avatar">{name.split(/\s+/).map((part: string) => part[0]).join('').slice(0, 2).toUpperCase()}</div><div className="driver-info"><strong>{name}</strong><span>{application.phone || 'No phone'} · {application.tricycle || 'Vehicle not supplied'}</span><small>{[application.vehicleMake, application.vehicleModel, application.vehicleColor].filter(Boolean).join(' · ') || 'Vehicle details incomplete'}</small><small>{application.operatingArea ? application.operatingArea + ', ' : ''}{application.operatingState || 'Ebonyi'} State · {application.user?.email || ''}</small><small>Date of birth: {application.dateOfBirth ? new Date(application.dateOfBirth).toLocaleDateString() : 'Not supplied'}</small></div><span className={'verification-state ' + statusClass(application.verificationStatus || 'pending')}>{String(application.verificationStatus || 'pending').replace(/_/g, ' ')}</span></div>
        <div className="verification-document-grid">{docs.map((doc: any) => <section className="verification-document-card" key={doc.id}><div className="verification-document-title"><strong>{typeLabel(doc.documentType)}</strong><span className={'verification-state ' + statusClass(doc.status)}>{String(doc.status).replace(/_/g, ' ')}</span></div><small>{doc.originalName} · {Math.max(1, Math.round((doc.sizeBytes || 0) / 1024))} KB</small>{doc.expiryDate && <small>Expiry: {new Date(doc.expiryDate).toLocaleDateString()}</small>}{doc.extractedData && <div className="extracted-field-list">{Object.entries(doc.extractedData as Record<string, any>).filter(([key, value]) => ['firstName', 'lastName', 'otherNames', 'fullName', 'name', 'dateOfBirth', 'date_of_birth', 'documentNumber', 'document_number', 'licenseNumber', 'licenceNumber', 'expiryDate', 'expiry_date', 'registrationNumber', 'registration_number', 'plateNumber', 'vin', 'chassisNumber', 'make', 'model'].includes(key) && ['string', 'number'].includes(typeof value) && String(value).trim()).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span><b>{String(value)}</b></div>)}</div>}{doc.automatedChecks && <><div className="automated-check-summary">{Object.entries(doc.automatedChecks as Record<string, any>).filter(([key, value]) => key !== 'notes' && typeof value === 'boolean').map(([key, value]) => <span key={key} className={value ? 'check-pass' : 'check-fail'}>{key.replace(/([A-Z])/g, ' $1')}: {value ? 'pass' : 'fail'}</span>)}</div>{doc.automatedChecks.officialReturnedDetails && <div className="extracted-field-list"><strong>Official registry response</strong>{Object.entries(doc.automatedChecks.officialReturnedDetails as Record<string, any>).filter(([key, value]) => ['firstName', 'lastName', 'otherNames', 'fullName', 'name', 'dateOfBirth', 'date_of_birth', 'documentNumber', 'document_number', 'licenseNumber', 'licenceNumber', 'expiryDate', 'expiry_date', 'registrationNumber', 'registration_number', 'plateNumber', 'vin', 'chassisNumber', 'make', 'model'].includes(key) && ['string', 'number'].includes(typeof value) && String(value).trim()).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')}</span><b>{String(value)}</b></div>)}</div>}</>}{doc.automatedChecks?.officialMessage && <p className="muted">Official check: {doc.automatedChecks.officialMessage}</p>}{Array.isArray(doc.automatedChecks?.notes) && doc.automatedChecks.notes.map((note: string, index: number) => <p className="muted" key={index}>{note}</p>)}{doc.reviewReason && <p className="muted">{doc.reviewReason}</p>}<a className="secondary-button compact" href={`${apiBase}/api/admin/driver-verifications/${application.id}/documents/${doc.id}/file`} target="_blank" rel="noreferrer">Open document</a><label>Review note / official reference<textarea rows={2} value={notes[doc.id] ?? doc.reviewReason ?? ''} onChange={e => setNotes({ ...notes, [doc.id]: e.target.value })} placeholder="Record the official result or reason for rejection" /></label><div className="verification-review-actions"><button className="primary-button compact" disabled={!!busy} onClick={() => review(doc, 'verified')}>{busy === doc.id + 'verified' ? 'Saving…' : 'Mark verified'}</button><button className="secondary-button compact" disabled={!!busy} onClick={() => review(doc, 'rejected')}>Reject</button><button className="secondary-button compact" disabled={!!busy} onClick={() => review(doc, 'needs_review')}>Needs review</button></div></section>)}</div>
        <div className="verification-application-footer"><span>{verifiedRequiredCount} of {requiredTypes.length} required documents verified</span><button className="primary-button compact" disabled={!!busy || application.verified} onClick={approve}>{busy === 'approve' ? 'Approving…' : application.verified ? 'Approved' : 'Approve driver'}</button></div>
    </article>;
}

function DriverAdminRow({ driver, approve }: any) { return <div className="driver-row"><div className="avatar">{driver.name.split(' ').map((n: string) => n[0]).join('')}</div><div className="driver-info"><strong>{driver.name}</strong><span>{driver.phone} · {driver.tricycle}</span></div><div className="doc-status"><FileCheck2 size={15} /> {driver.verified ? 'Verified' : 'Documents submitted'}</div>{!driver.verified && <button className="primary-button compact" onClick={approve}>Approve</button>}</div> }
function RideAdminRow({ ride }: any) { return <div className="ride-row"><div><strong>{ride.passenger}</strong><span>{ride.pickup} → {ride.destination}</span></div><span className={'ride-status ' + ride.status.toLowerCase().replace(/ /g, '-')}>{ride.status}</span></div> }

function BottomNav({ tab, setTab, driver = false }: any) { return <nav className={'bottom-nav ' + (driver ? 'driver-bottom-nav' : '')}><button className={tab === 'home' ? 'nav-active' : ''} onClick={() => setTab('home')}><Home size={19} /><span>Home</span></button><button className={(driver ? tab === 'requests' : tab === 'trips') ? 'nav-active' : ''} onClick={() => setTab(driver ? 'requests' : 'trips')}><Activity size={19} /><span>{driver ? 'Requests' : 'Trips'}</span></button>{!driver && <button className="ride-action" onClick={() => setTab('request')}><CarFront size={20} /></button>}<button className={(driver ? tab === 'trips' : tab === 'safety') ? 'nav-active' : ''} onClick={() => setTab(driver ? 'trips' : 'safety')}><ShieldAlert size={19} /><span>{driver ? 'History' : 'Safety'}</span></button><button className={tab === 'profile' ? 'nav-active' : ''} onClick={() => setTab('profile')}><UserRound size={19} /><span>Profile</span></button></nav> }

export default App;
