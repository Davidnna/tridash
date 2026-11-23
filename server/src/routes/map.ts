import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

const router = Router();

type MapboxFeature = {
    properties?: { full_address?: string; name?: string };
    place_name?: string;
};

type MapboxGeocodeResponse = { features?: MapboxFeature[] };
type MapboxRouteResponse = { routes?: Array<{ distance: number; duration: number; geometry: unknown }> };

async function readMapboxJson<T>(response: Response): Promise<T> {
    return response.json() as Promise<T>;
}

function isMapboxRouteResponse(data: MapboxRouteResponse): data is Required<MapboxRouteResponse> {
    return Array.isArray(data.routes);
}

function isMapboxGeocodeResponse(data: MapboxGeocodeResponse): data is Required<MapboxGeocodeResponse> {
    return Array.isArray(data.features);
}

function isMapboxFeature(value: MapboxFeature | undefined): value is MapboxFeature {
    return Boolean(value);
}

void isMapboxFeature;


// Get Mapbox token
router.get('/mapbox-token', async (req, res) => {
    try {
        const token = process.env.MAPBOX_PUBLIC_TOKEN;

        if (!token) {
            return res.status(503).json({ error: 'Map service is not configured' });
        }

        res.json({ token });
    } catch (error) {
        console.error('Get Mapbox token error:', error);
        res.status(500).json({ error: 'Failed to get map token' });
    }
});

// Geocode (search for location)
router.get('/geocode', requireAuth(), async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();

        if (!q) {
            return res.status(400).json({ error: 'A destination search is required' });
        }

        const token = process.env.MAPBOX_PUBLIC_TOKEN;

        if (!token) {
            return res.status(503).json({ error: 'Map service is not configured' });
        }

        const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=ng&limit=1&autocomplete=true&access_token=${encodeURIComponent(token)}`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(502).json({ error: 'Location search is temporarily unavailable' });
        }

        const data = await response.json() as MapboxGeocodeResponse;
        const feature = data.features?.[0];

        if (!feature) {
            return res.status(404).json({ error: 'Destination not found' });
        }

        res.json({ feature });
    } catch (error) {
        console.error('Geocode error:', error);
        res.status(502).json({ error: 'Location search is temporarily unavailable' });
    }
});

// Reverse geocode (coordinates to address)
router.get('/reverse', async (req, res) => {
    try {
        const lng = Number(req.query.lng);
        const lat = Number(req.query.lat);

        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return res.status(400).json({ error: 'Valid coordinates are required' });
        }

        const token = process.env.MAPBOX_PUBLIC_TOKEN;

        if (!token) {
            return res.status(503).json({ error: 'Map service is not configured' });
        }

        const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&country=ng&limit=1&access_token=${encodeURIComponent(token)}`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(502).json({ error: 'Address lookup is temporarily unavailable' });
        }

        const data = await response.json() as MapboxGeocodeResponse;
        const feature = data.features?.[0];

        res.json({
            placeName: feature?.properties?.full_address || feature?.properties?.name || feature?.place_name || null,
        });
    } catch (error) {
        console.error('Reverse geocode error:', error);
        res.status(502).json({ error: 'Address lookup is temporarily unavailable' });
    }
});

// Get route between two points
router.get('/route', requireAuth(), async (req, res) => {
    try {
        const fromLat = Number(req.query.fromLat);
        const fromLng = Number(req.query.fromLng);
        const toLat = Number(req.query.toLat);
        const toLng = Number(req.query.toLng);

        const values = [fromLat, fromLng, toLat, toLng];

        if (!values.every(Number.isFinite)) {
            return res.status(400).json({ error: 'Valid route coordinates are required' });
        }

        const token = process.env.MAPBOX_PUBLIC_TOKEN;

        if (!token) {
            return res.status(503).json({ error: 'Map service is not configured' });
        }

        const coordinates = `${fromLng},${fromLat};${toLng},${toLat}`;
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?overview=full&geometries=geojson&steps=false&access_token=${encodeURIComponent(token)}`;

        const response = await fetch(url);

        if (!response.ok) {
            return res.status(502).json({ error: 'Routing service is temporarily unavailable' });
        }

        const data = await response.json() as MapboxRouteResponse;
        const route = data.routes?.[0];

        if (!route) {
            return res.status(404).json({ error: 'No drivable route found' });
        }

        res.json({
            route: {
                distanceMeters: route.distance,
                durationSeconds: route.duration,
                geometry: route.geometry,
            },
        });
    } catch (error) {
        console.error('Route error:', error);
        res.status(502).json({ error: 'Routing service is temporarily unavailable' });
    }
});

export default router;
