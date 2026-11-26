# Tridash

Tridash is a tricycle transportation management and safety platform. It connects passengers with registered tricycle operators and provides ride requests, driver onboarding and verification, trip records, payments, reporting and administrative oversight.

The project contains a responsive React web application and an Express API with Socket.IO, PostgreSQL and Prisma. The same web application serves the public information pages and authenticated passenger, driver and administrator workspaces.

## Product areas

- **Public website:** Home, About, How it works, Safety, Become a driver, FAQs, Contact, Privacy and Terms.
- **Passenger workspace:** Profile management, ride requests, available and assigned driver information, trip status and history, ratings, reports and safety tools.
- **Driver workspace:** Driver and vehicle onboarding, verification documents, availability, ride requests, trip management, trip history, passenger reviews, incident reporting and optional payout account details.
- **Administrator workspace:** Overview statistics, user and driver management, document review, ride monitoring, incident reporting, payment records and platform settings.
- **Shared services:** Firebase Authentication, API sessions, PostgreSQL persistence, Mapbox maps and routes, Socket.IO updates, Firebase browser push, optional Twilio emergency SMS, cash fare records and Paystack payments.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router |
| UI icons | Lucide React |
| Maps | Mapbox GL JS |
| Backend | Node.js, Express, Socket.IO, TypeScript |
| Database | PostgreSQL, Prisma |
| Authentication | Firebase Authentication and backend session handling |
| Payments | Cash fare recording and Paystack online payment |

## Project structure

```text
tridash-master/
    public/
    src/
        api/
        App.tsx
        MapView.tsx
        RequestPageMap.tsx
        index.css
        design-system.css
        main.tsx
    server/
        prisma/
            migrations/
            schema.prisma
        src/
            middleware/
            routes/
            services/
            utils/
    tests/
    index.html
    package.json
    package-lock.json
    README.md
```

The fare formula is `max(minimum fare, base fare + (road distance in km × fare per km))`. The backend recalculates the route and fare at ride creation; the amount sent by the browser is not trusted.

The frontend uses shared design tokens and reusable styles for the public site and authenticated workspaces. The interface follows the original Tridash prototype's visual language: Space Grotesk headings, Inter interface text, JetBrains Mono metadata, deep green primary surfaces, signal green, amber actions, pale-green backgrounds, white cards and rounded controls.

## Requirements

Install the following before running the project:

- Node.js 20 or later
- npm
- PostgreSQL database
- Firebase project configured for Authentication
- Mapbox access token
- Paystack test or live credentials when online payment and driver payout splitting are enabled
- Optional Twilio credentials for emergency-contact SMS
- Firebase Web Push VAPID key for browser push notifications

## Run locally

Run the backend and frontend in separate terminals from the project root.

### 1. Configure the backend environment

Create the local backend environment file:

```bash
cp server/.env.example server/.env
```

Create the local frontend environment file at the project root when you need to override the defaults:

```bash
cp .env.example .env
```

`node_modules/`, `.git/`, local `.env` files and generated build folders are intentionally excluded from the source ZIP. Install dependencies with `npm ci` in the frontend root and in `server/`.

Set the database connection and service configuration in `server/.env`. At minimum, configure:

- `DATABASE_URL`
- `DIRECT_URL` (the direct PostgreSQL connection used by Prisma migrations)
- `PORT`
- `NODE_ENV`
- `FRONTEND_URL`
- `JWT_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `MAPBOX_PUBLIC_TOKEN`
- `PAYSTACK_SECRET_KEY`
- `SUPER_ADMIN_EMAIL`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (optional; needed for automatic emergency-contact SMS)
- `PUBLIC_APP_URL` (optional; used to construct trip-share and emergency links)

For local development, `FRONTEND_URL` should normally be `http://localhost:5173`. Keep provider secrets and private keys in the backend environment only.

### 2. Install and start the backend

```bash
cd server
npm ci
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The Express API and Socket.IO server start on `http://localhost:3001` by default.

### 3. Install and start the frontend

Open a second terminal at the project root:

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` in a browser. The frontend uses `http://localhost:3001` as its default API base URL. Set `VITE_API_URL` if the backend runs at another address.

### 4. Useful commands

From the project root:

```bash
npm run dev
npm run build
npm run preview
```

From `server/`:

```bash
npm run dev
npm run build
npm start
npx prisma generate
npx prisma migrate deploy
npx prisma studio
```

Use `npx prisma migrate deploy` to apply committed migrations. Use `npx prisma migrate dev` only when creating a new development migration.

## Driver verification and private documents

Driver onboarding collects personal, contact, operating-area and vehicle information and supports private uploads for government identification, driving licence and vehicle registration. Drivers must complete the required verification workflow before they can be approved and go online.

For local development, the default private document storage path is configured through `DRIVER_DOCUMENT_STORAGE_DIR`. Set `DRIVER_DOCUMENT_ENCRYPTION_KEY` to a 32-byte hexadecimal key. Generate one with:

```bash
openssl rand -hex 32
```

Production document storage must use a private persistent volume. Keep the encryption key in the backend secret manager and back it up separately from the encrypted files. The upload directory is not a public static directory.

Optional verification integrations are configured through the backend adapter variables in `server/.env.example`. Without a configured provider, uploaded documents remain available for administrator review; they are not automatically treated as officially verified.

## Driver payouts

The payout account workflow uses Paystack's Nigerian NGN bank list, supports paginated bank retrieval and code-based deduplication, and provides a searchable bank picker with loading, retry and stale-cache states. Account details are re-resolved on the server before saving. Existing subaccounts are updated when bank details change.

Test bank listing, account resolution, subaccount creation or update and payment splits in Paystack Test Mode before production use.

## Frontend configuration

The frontend recognises these optional environment variables:

- `VITE_FIREBASE_VAPID_KEY` — Firebase Cloud Messaging Web Push certificate key; required to register browser push tokens.
- `VITE_API_URL` — public backend API origin.
- `VITE_TRIDASH_DEPLOYMENT` — deployment mode (`combined`, `public` or the configured app mode).
- `VITE_TRIDASH_APP_URL` — authenticated application origin used by public-site sign-in and registration links.

The public and application production hosts are also distinguished by hostname in `src/main.tsx`.

## Deployment overview

A split deployment can host the frontend on a static web host, the backend on a Node-compatible service and PostgreSQL on a managed database provider.

1. Configure the production database and backend environment variables.
2. Back up the production database, then run `npx prisma generate` and `npx prisma migrate deploy` in the backend deployment process. Review the pending SQL migrations before applying them to production.
3. Build the frontend with `npm run build` and publish the `dist/` directory.
4. Set `VITE_API_URL` to the backend origin and configure the frontend origin in the backend's `FRONTEND_URL`.
5. Configure Firebase authorized domains, Paystack callback URLs, Mapbox token restrictions and HTTPS/WSS.
6. Configure the frontend host to serve `index.html` for client-side routes so direct navigation and page refreshes work.
7. Test authentication, ride requests, driver acceptance, trip status updates, payments, notifications, administrator review and sign-out on the deployed services.

## Quality checks

Run the source-contract checks, frontend production build and backend TypeScript build before deployment:

```bash
npm test
npm run build
```

```bash
cd server
npm run build
```

The project uses four-space indentation. Keep the code organised into reusable components, API modules, backend routes, services and utilities. This repository's project documentation is maintained in this `README.md` file.

## Requirements completion updates

The requirements-completion work adds the following backend capabilities:

- An independent `Tricycle` register, with plate-number uniqueness, driver assignment, vehicle verification status and active/suspended/inactive status. Driver onboarding and administrator approval synchronise the driver vehicle details with this register.
- A `PlatformSetting` store for administrator-managed platform name, support contacts, service area, commission, base fare, per-kilometre fare, minimum fare and service pause configuration.
- Incident workflow states (`open`, `under_review`, `resolved`, `closed`), reporter and reported-account references, administrator assignment, resolution notes, timestamps and an append-only activity history.
- Passenger incident reports for active or historical trips and driver incident reports for an assigned trip or a driver-level issue.
- In-app administrator alerts and Firebase browser push delivery for ride and safety events when both the Firebase Web Push VAPID key and backend Firebase Admin credentials are configured.
- Optional Twilio SMS delivery for emergency contacts when the Twilio credentials are configured. SMS delivery results are returned to the caller; the application does not claim delivery when the provider is absent or rejects the message.
- Persisted ride `startedAt` and `completedAt` timestamps.
- Server-calculated ride fares based on Mapbox road distance and administrator-configured base, per-kilometre and minimum fares. Client-supplied fare values are ignored.
- Cash ride payment recording, with driver confirmation after cash collection; Paystack remains optional and is selected explicitly by the passenger.
- Driver-facing recent passenger reviews and incident reporting, plus passenger-facing verified online driver availability.
- Account `inactive` status enforcement in authenticated API requests, with driver availability disabled when a driver account is suspended or deactivated.
- Administrator API and dashboard controls for tricycle registration, vehicle status, incident resolution and editable platform settings.

### Apply the requirements-completion migration

After configuring the backend environment and confirming a current database backup, run from `server/`:

```bash
npx prisma generate
npx prisma migrate deploy
npm run build
```

The migrations create the tricycle and platform-setting tables, add incident workflow and audit fields, create push-token storage, add trip lifecycle timestamps, and backfill the independent tricycle register from existing driver vehicle details. Existing driver and ride records are retained.

### Operational integration boundaries

The SOS workflow records the event, creates an expiring trip-share link and creates administrator in-app notifications. If Twilio is configured, Tridash attempts to send the emergency contact an SMS containing the trip link. The API returns whether the SMS provider accepted the message. This is not an emergency-services dispatch connection.

The trip-sharing workflow also creates a time-limited public tracking link and attempts to send it to the signed-in user's saved emergency contact by SMS when Twilio is configured. A missing or failed SMS configuration does not prevent the link from being shared manually.

Browser push requires `VITE_FIREBASE_VAPID_KEY`, a Firebase Web Push certificate, the Firebase Admin service account on the backend and a deployed HTTPS origin. Without these settings, in-app notifications continue to work.

Driver matching currently notifies verified online drivers across the platform; it is not yet distance- or service-area-filtered. The available-driver list is labelled accordingly. Paystack is optional for a ride; a driver without a verified Paystack subaccount can accept cash rides but cannot accept a Paystack ride requiring split settlement.

This repository contains the responsive web application and backend. It does not contain separately buildable Android/iOS native applications. Those require a dedicated React Native/Expo client and platform-specific build, signing and device testing before they can be considered deliverables.
