import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Navigation, Pencil, ShieldCheck } from 'lucide-react';
import { api } from './api/client';
import MapView, { reverseGeocode, searchPlace, type GeoPoint, type RouteData } from './MapView';

export default function RequestPageMap({ requestRide, setTab, notify, profile }: { requestRide: any; setTab: any; notify: any; profile: any }) {
    const [pickup, setPickup] = useState('Abakaliki, Ebonyi State');
    const [destination, setDestination] = useState('');
    const [pickupCoords, setPickupCoords] = useState<GeoPoint | null>({ lat: 6.3249, lng: 8.1137 });
    const [destinationCoords, setDestinationCoords] = useState<GeoPoint | null>(null);
    const [route, setRoute] = useState<RouteData | null>(null);
    const [fare, setFare] = useState(2000);
    const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Paystack'>('Cash');
    const [busy, setBusy] = useState(false);
    const [locating, setLocating] = useState(false);
    const [gpsError, setGpsError] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const confirmDialogRef = useRef<HTMLDivElement | null>(null);
    const confirmRequestButtonRef = useRef<HTMLButtonElement | null>(null);
    const submittingRef = useRef(submitting);

    useEffect(() => {
        submittingRef.current = submitting;
    }, [submitting]);

    useEffect(() => {
        if (!confirmOpen) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        confirmRequestButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !submittingRef.current) {
                event.preventDefault();
                setConfirmOpen(false);
                return;
            }
            if (event.key !== 'Tab' || !confirmDialogRef.current) return;
            const focusable = Array.from(confirmDialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ));
            if (!focusable.length) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !confirmDialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !confirmDialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            previouslyFocused?.focus();
        };
    }, [confirmOpen]);
    const [editingPhone, setEditingPhone] = useState(false);
    const [ridePhone, setRidePhone] = useState(profile.phone || '');

    useEffect(() => setRidePhone(profile.phone || ''), [profile.phone]);

    const applyPosition = async (position: GeolocationPosition) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        setPickupCoords(point);
        setGpsError('');
        setLocating(false);
        const address = await reverseGeocode(point);
        setPickup(address || 'My current location');
    };

    const locate = () => {
        if (!navigator.geolocation) {
            notify('GPS is not available in this browser.');
            return;
        }
        setLocating(true);
        setGpsError('');
        navigator.geolocation.getCurrentPosition(
            position => { applyPosition(position).then(() => notify('Your pickup location is ready.')); },
            error => {
                const message = error.code === 1 ? 'Location permission was denied.' : error.code === 2 ? 'Your location is currently unavailable.' : error.code === 3 ? 'GPS timed out.' : 'We could not read your GPS.';
                setGpsError(message + ' You can still enter a pickup manually.');
                setLocating(false);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
    };

    useEffect(() => {
        if (!navigator.geolocation) return;
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            position => { applyPosition(position); },
            () => setLocating(false),
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 12000 }
        );
    }, []);

    const find = async () => {
        if (!destination.trim()) return;
        setBusy(true);
        try {
            const point = await searchPlace(destination.trim(), pickupCoords);
            if (!point) throw new Error('Destination not found. Try a nearby landmark, street or area.');
            setDestinationCoords(point);
            if (pickupCoords) {
                const response = await api.get('/api/route?fromLat=' + pickupCoords.lat + '&fromLng=' + pickupCoords.lng + '&toLat=' + point.lat + '&toLng=' + point.lng);
                const nextRoute = response.data?.route || null;
                setRoute(nextRoute);
                if (nextRoute?.estimatedFare) setFare(nextRoute.estimatedFare);
            }
            notify('Destination found and route loaded.');
        } catch (error: any) {
            setDestinationCoords(null);
            setRoute(null);
            setFare(2000);
            notify(error?.message || 'We could not find that destination.');
        } finally {
            setBusy(false);
        }
    };

    const confirmRide = async () => {
        if (submitting) return;
        if (!ridePhone.trim() || ridePhone.trim().length < 7) {
            notify('Add a valid phone number for this ride.');
            setEditingPhone(true);
            return;
        }
        setSubmitting(true);
        try {
            await requestRide(pickup, destination.trim(), fare, pickupCoords || undefined, destinationCoords || undefined, {
                name: profile.name,
                phone: ridePhone.trim(),
                bookedForSelf: true
            }, paymentMethod);
            setConfirmOpen(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="mobile-frame booking-page">
            <section className="screen-head">
                <button type="button" className="back-button" aria-label="Back to home" onClick={() => setTab('home')}>←</button>
                <div><div className="eyebrow">NEW RIDE</div><h2>Request a ride</h2></div>
            </section>
            <div className="booking-intro">
                <div className="booking-intro-icon"><Navigation size={18} /></div>
                <div><strong>Where are you going?</strong><span>Set your pickup and destination. We’ll show the route and estimated fare before you confirm.</span></div>
            </div>
            <div className="form-card booking-location-card">
                <label>Pickup location<input value={pickup} onChange={event => { setPickup(event.target.value); setPickupCoords(null); setRoute(null); }} placeholder="Enter pickup point" /></label>
                <button className="secondary-button location-button" disabled={locating} onClick={locate}><Navigation size={16} />{locating ? 'Finding your location…' : 'Use my current location'}</button>
                {gpsError && <div className="gps-error"><Navigation size={15} />{gpsError}</div>}
                <label>Destination<input value={destination} onChange={event => { setDestination(event.target.value); setDestinationCoords(null); setRoute(null); }} onBlur={find} placeholder="Search a street, landmark or area" /></label>
                <button className="secondary-button full" disabled={!destination.trim() || busy} onClick={find}>{busy ? 'Finding route…' : 'Find route'} <ChevronRight size={17} /></button>
            </div>
            <MapView pickup={pickupCoords} destination={destinationCoords} userLocation={pickupCoords} route={route} />
            <div className="map-attribution-note">Map powered by Mapbox · GPS provided by your device</div>
            {route && <div className="route-summary"><strong>{(route.distanceMeters / 1000).toFixed(1)} km</strong><span>about {Math.max(1, Math.round(route.durationSeconds / 60))} min by road</span></div>}
            <div className="form-card contact-card">
                <div className="contact-card-head">
                    <div><span className="contact-label">RIDE CONTACT</span><strong>{ridePhone || 'Phone number not set'}</strong><small>From your Tridash profile</small></div>
                    <button className="text-button-inline" onClick={() => setEditingPhone(value => !value)}><Pencil size={14} /> {editingPhone ? 'Done' : 'Edit'}</button>
                </div>
                {editingPhone && <input className="contact-edit-input" type="tel" value={ridePhone} onChange={event => setRidePhone(event.target.value)} placeholder="080..." />}
            </div>
            <div className="booking-summary">
                <div><span>ESTIMATED FARE</span><strong>₦{fare.toLocaleString()}</strong></div>
                <div><span>PAYMENT</span><strong>{paymentMethod === 'Cash' ? 'Cash to driver' : 'Online · Paystack'}</strong></div>
                <div><span>ROUTE</span><strong>{route ? (route.distanceMeters / 1000).toFixed(1) + ' km · ' + Math.max(1, Math.round(route.durationSeconds / 60)) + ' min' : 'Find a route first'}</strong></div>
            </div>
            <div className="form-card payment-choice-card"><strong>Choose how to pay</strong><label><input type="radio" name="paymentMethod" value="Cash" checked={paymentMethod === 'Cash'} onChange={() => setPaymentMethod('Cash')} /> Cash — pay the driver directly after the trip</label><label><input type="radio" name="paymentMethod" value="Paystack" checked={paymentMethod === 'Paystack'} onChange={() => setPaymentMethod('Paystack')} /> Pay online with Paystack after the trip</label></div>
            <p className="hint">Cash payments are confirmed by the driver after collection. Paystack payments are verified by Tridash before being marked paid.</p>
            <button className="primary-button full" disabled={!pickupCoords || !destinationCoords || busy || submitting} aria-busy={submitting} onClick={() => setConfirmOpen(true)}>{submitting ? 'Requesting your ride…' : 'Review and request ride'} <ShieldCheck size={17} /></button>
            {confirmOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setConfirmOpen(false); }}><div ref={confirmDialogRef} className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="request-confirm-title" aria-describedby="request-confirm-description"><div className="eyebrow">CONFIRM RIDE</div><h3 id="request-confirm-title">Ready to request?</h3><p id="request-confirm-description">{pickup} → {destination} · ₦{fare.toLocaleString()} estimated fare · {paymentMethod === 'Cash' ? 'Cash' : 'Paystack'}</p><div className="confirm-contact"><span>Contact</span><strong>{ridePhone}</strong></div><div className="confirm-actions"><button type="button" className="secondary-button" onClick={() => setConfirmOpen(false)}>Review again</button><button ref={confirmRequestButtonRef} type="button" className="primary-button" disabled={submitting} aria-busy={submitting} onClick={confirmRide}>{submitting ? 'Requesting…' : 'Request ride'}</button></div></div></div>}
        </div>
    );
}
