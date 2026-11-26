import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = file => readFileSync(path.join(root, file), 'utf8');

test('project keeps one Markdown documentation file', () => {
    const markdownFiles = [];
    const walk = directory => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(fullPath);
            else if (entry.name.toLowerCase().endsWith('.md')) markdownFiles.push(path.relative(root, fullPath));
        }
    };
    walk(root);
    assert.deepEqual(markdownFiles, ['README.md']);
});

test('required database models are declared', () => {
    const schema = read('server/prisma/schema.prisma');
    for (const model of ['Tricycle', 'PlatformSetting', 'IncidentActivity', 'PushToken']) {
        assert.match(schema, new RegExp(`model ${model} \\{`));
    }
});

test('core completion routes exist', () => {
    const rides = read('server/src/routes/rides.ts');
    const admin = read('server/src/routes/admin.ts');
    const notifications = read('server/src/routes/notifications.ts');
    assert.match(rides, /cash-payment\/confirm/);
    assert.match(admin, /\/overview/);
    assert.match(admin, /\/tricycles/);
    assert.match(admin, /\/incidents/);
    assert.match(notifications, /device-token/);
});

test('incident handling records reports, audit history and SOS trip shares', () => {
    const incidents = read('server/src/routes/incidents.ts');
    assert.match(incidents, /incidentActivity\.create/);
    assert.match(incidents, /reportedUserId/);
    assert.match(incidents, /tripShare\.create/);
    assert.match(incidents, /sendSms/);
});

test('ride lifecycle protects role-specific transitions and payment selection', () => {
    const rides = read('server/src/routes/rides.ts');
    assert.match(rides, /paymentMethod/);
    assert.match(rides, /updateMany/);
    assert.match(rides, /driverId: user\.id/);
    assert.match(rides, /paymentMethod !== 'Cash'/);
});

test('delivery ignores local dependencies, build output and secrets', () => {
    const ignore = read('.gitignore');
    assert.match(ignore, /node_modules/);
    assert.match(ignore, /dist/);
    assert.match(ignore, /\.env/);
    assert.equal(existsSync(path.join(root, '.env')), false);
    assert.equal(existsSync(path.join(root, 'server', '.env')), false);
});

test('ride fares are recalculated from server-side route distance', () => {
    const rides = read('server/src/routes/rides.ts');
    const map = read('server/src/routes/map.ts');
    const fare = read('server/src/services/fare.ts');
    assert.match(rides, /getRouteDistanceMeters\(normalizedPickupCoords, normalizedDestinationCoords\)/);
    assert.match(rides, /const fareAmount = fare\.amount/);
    assert.match(map, /estimatedFare: fare\.amount/);
    assert.match(fare, /baseFare \+ Math\.round\(distanceKm \* config\.farePerKm\)/);
});

test('personal driver phone and location are not exposed in the public driver directory', () => {
    const drivers = read('server/src/routes/drivers.ts');
    assert.match(drivers, /phone: req\.user\?\.role === 'admin'/);
    assert.doesNotMatch(drivers.slice(0, drivers.indexOf("router.get('/verification-config'")), /lastLocation: true/);
});
