import prisma from '../utils/database';

export type FareConfig = {
    baseFare: number;
    farePerKm: number;
    minimumFare: number;
};

async function readNumericSetting(key: string, fallback: number) {
    try {
        const setting = await prisma.platformSetting.findUnique({ where: { key } });
        const value = Number(setting?.value ?? fallback);
        return Number.isFinite(value) && value >= 0 && value <= 100000 ? value : fallback;
    } catch {
        return fallback;
    }
}

export async function getFareConfig(): Promise<FareConfig> {
    const [baseFare, farePerKm, minimumFare] = await Promise.all([
        readNumericSetting('base_fare_ngn', 500),
        readNumericSetting('fare_per_km_ngn', 250),
        readNumericSetting('minimum_fare_ngn', 800),
    ]);
    return { baseFare, farePerKm, minimumFare };
}

export async function calculateFareFromDistance(distanceMeters: number) {
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || distanceMeters > 250000) {
        throw Object.assign(new Error('The route distance is invalid or outside the supported service range.'), { statusCode: 400 });
    }
    const config = await getFareConfig();
    const distanceKm = distanceMeters / 1000;
    const calculated = Math.max(config.minimumFare, config.baseFare + Math.round(distanceKm * config.farePerKm));
    return { amount: calculated, distanceMeters, config };
}

export async function getRouteDistanceMeters(
    pickupCoords: { lat: number; lng: number },
    destinationCoords: { lat: number; lng: number },
) {
    const coordinates = [pickupCoords.lat, pickupCoords.lng, destinationCoords.lat, destinationCoords.lng];
    if (!coordinates.every(Number.isFinite)
        || Math.abs(pickupCoords.lat) > 90 || Math.abs(destinationCoords.lat) > 90
        || Math.abs(pickupCoords.lng) > 180 || Math.abs(destinationCoords.lng) > 180) {
        throw Object.assign(new Error('Valid pickup and destination coordinates are required.'), { statusCode: 400 });
    }

    const token = process.env.MAPBOX_PUBLIC_TOKEN;
    if (!token) throw Object.assign(new Error('Map service is not configured.'), { statusCode: 503 });

    const routeCoordinates = `${pickupCoords.lng},${pickupCoords.lat};${destinationCoords.lng},${destinationCoords.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${routeCoordinates}?overview=false&steps=false&access_token=${encodeURIComponent(token)}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw Object.assign(new Error('Routing service is temporarily unavailable.'), { statusCode: 502 });
        const data = await response.json() as { routes?: Array<{ distance?: number }> };
        const distanceMeters = Number(data.routes?.[0]?.distance);
        if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
            throw Object.assign(new Error('No drivable route was found for these locations.'), { statusCode: 422 });
        }
        return distanceMeters;
    } catch (error: any) {
        if (error?.statusCode) throw error;
        throw Object.assign(new Error('Routing service is temporarily unavailable.'), { statusCode: 502 });
    }
}
