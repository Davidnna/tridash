import { useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

export type GeoPoint = { lat: number; lng: number };
export type RouteData = { distanceMeters: number; durationSeconds: number; geometry: any; estimatedFare?: number };

type Props = {
    pickup?: GeoPoint | null;
    destination?: GeoPoint | null;
    userLocation?: GeoPoint | null;
    driverLocation?: GeoPoint | null;
    route?: RouteData | null;
    followDriver?: boolean;
};

export default function MapView({ pickup, destination, userLocation, driverLocation, route, followDriver = false }: Props) {
    const node = useRef<HTMLDivElement | null>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const markers = useRef<mapboxgl.Marker[]>([]);
    const [routeData, setRouteData] = useState<RouteData | null>(route || null);
    const [mapError, setMapError] = useState('');

    useEffect(() => setRouteData(route || null), [route]);

    useEffect(() => {
        let cancelled = false;
        if (!node.current || map.current) return;

        const initialize = async () => {
            try {
                const response = await api.get('/api/mapbox-token');
                const token = String(response.data?.token || '');
                if (!token) throw new Error('Map service is not configured');
                if (!mapboxgl.supported()) throw new Error('Mapbox is not supported in this browser');
                if (cancelled || !node.current) return;

                const center = userLocation || pickup || driverLocation || { lat: 6.3249, lng: 8.1137 };
                const instance = new mapboxgl.Map({
                    accessToken: token,
                    container: node.current,
                    style: 'mapbox://styles/mapbox/standard',
                    center: [center.lng, center.lat],
                    zoom: 14,
                    attributionControl: true
                });
                map.current = instance;
                instance.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
                instance.on('error', event => {
                    if (event?.error?.message) setMapError('Map tiles could not be loaded. Please check your connection.');
                });
                instance.once('load', () => window.setTimeout(() => instance.resize(), 100));
            } catch (error: any) {
                if (!cancelled) setMapError(error?.message || 'Map could not be loaded.');
            }
        };

        initialize();
        return () => {
            cancelled = true;
            markers.current.forEach(marker => marker.remove());
            markers.current = [];
            map.current?.remove();
            map.current = null;
        };
    }, []);

    useEffect(() => {
        const instance = map.current;
        if (!instance) return;

        const render = () => {
            markers.current.forEach(marker => marker.remove());
            markers.current = [];

            const points: [number, number][] = [];
            const addMarker = (point: GeoPoint | null | undefined, label: string, kind: string) => {
                if (!point) return;
                const element = document.createElement('div');
                element.className = 'tridash-map-marker ' + kind;
                element.textContent = kind === 'driver' ? '🛺' : '';
                element.title = label;
                element.setAttribute('role', 'img');
                element.setAttribute('aria-label', label);
                const marker = new mapboxgl.Marker({ element })
                    .setLngLat([point.lng, point.lat])
                    .setPopup(new mapboxgl.Popup({ offset: 18, closeButton: false }).setText(label))
                    .addTo(instance);
                markers.current.push(marker);
                points.push([point.lng, point.lat]);
            };

            addMarker(userLocation, 'Your location', 'user');
            if (pickup && (!userLocation || pickup.lat !== userLocation.lat || pickup.lng !== userLocation.lng)) {
                addMarker(pickup, 'Pickup', 'pickup');
            }
            addMarker(destination, 'Destination', 'destination');
            addMarker(driverLocation, 'Driver live location', 'driver');

            const geometry = routeData?.geometry || { type: 'LineString', coordinates: [] };
            if (instance.getSource('tridash-route')) {
                (instance.getSource('tridash-route') as mapboxgl.GeoJSONSource).setData({
                    type: 'Feature',
                    properties: {},
                    geometry
                } as any);
            } else {
                instance.addSource('tridash-route', {
                    type: 'geojson',
                    data: { type: 'Feature', properties: {}, geometry } as any
                });
                instance.addLayer({
                    id: 'tridash-route-line',
                    type: 'line',
                    source: 'tridash-route',
                    layout: { 'line-cap': 'round', 'line-join': 'round' },
                    paint: { 'line-color': '#1E8E5A', 'line-width': 5, 'line-opacity': 0.9 }
                });
            }

            if (followDriver && driverLocation) {
                instance.easeTo({ center: [driverLocation.lng, driverLocation.lat], zoom: 15, duration: 500 });
            } else if (points.length > 1) {
                const bounds = points.reduce(
                    (value, point) => value.extend(point),
                    new mapboxgl.LngLatBounds(points[0], points[0])
                );
                instance.fitBounds(bounds, { padding: 35, maxZoom: 15, duration: 450 });
            } else if (points.length === 1) {
                instance.easeTo({ center: points[0], zoom: 15, duration: 350 });
            }
            window.setTimeout(() => instance.resize(), 50);
        };

        if (instance.isStyleLoaded()) render();
        else instance.once('load', render);
    }, [pickup, destination, userLocation, driverLocation, routeData, followDriver]);

    useEffect(() => {
        if (!pickup || !destination || routeData) return;
        let cancelled = false;
        api.get('/api/route?fromLat=' + pickup.lat + '&fromLng=' + pickup.lng + '&toLat=' + destination.lat + '&toLng=' + destination.lng)
            .then((response: any) => { if (!cancelled) setRouteData(response.data?.route || null); })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [pickup, destination, routeData]);

    return (
        <div className="map-card real-map" role="region" aria-label="Interactive map showing pickup, destination, and driver location">
            <div ref={node} className="real-map-canvas" />
            {mapError && <div className="map-error-overlay" role="alert">{mapError}</div>}
        </div>
    );
}

export async function searchPlace(query: string, proximity?: GeoPoint | null): Promise<GeoPoint | null> {
    const params = new URLSearchParams({ q: query, limit: '1' });
    if (proximity) params.set('proximity', proximity.lng + ',' + proximity.lat);
    const response = await api.get('/api/mapbox/geocode?' + params.toString());
    const coords = response.data?.feature?.geometry?.coordinates;
    return Array.isArray(coords) ? { lat: Number(coords[1]), lng: Number(coords[0]) } : null;
}

export async function reverseGeocode(point: GeoPoint): Promise<string | null> {
    try {
        const response = await api.get('/api/mapbox/reverse?lng=' + point.lng + '&lat=' + point.lat);
        return response.data?.placeName || null;
    } catch {
        return null;
    }
}
