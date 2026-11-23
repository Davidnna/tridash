# Tridash

Tridash is a tricycle transportation management and safety platform. It connects passengers with registered tricycle operators and provides ride requests, driver onboarding and verification, trip records, payments, reporting and administrative oversight.

The project contains a responsive React web application and an Express API with Socket.IO, PostgreSQL and Prisma. The same web application serves the public information pages and authenticated passenger, driver and administrator workspaces.

## Product areas

- **Public website:** Home, About, How it works, Safety, Become a driver, FAQs, Contact, Privacy and Terms.
- **Passenger workspace:** Profile management, ride requests, trip status and history, driver and vehicle details, ratings, reports and safety tools.
- **Driver workspace:** Driver and vehicle onboarding, verification documents, availability, ride requests, trip management, trip history and payout account details.
- **Administrator workspace:** Overview statistics, user and driver management, document review, ride monitoring, incident reporting, payment records and platform settings.
- **Shared services:** Firebase Authentication, API sessions, PostgreSQL persistence, Mapbox maps and routes, Socket.IO updates and Paystack payments.

## Technology

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router |
| UI icons | Lucide React |
| Maps | Mapbox GL JS |
| Backend | Node.js, Express, Socket.IO, TypeScript |
| Database | PostgreSQL, Prisma |
| Authentication | Firebase Authentication and backend session handling |
| Payments | Paystack |

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

The frontend uses shared design tokens and reusable styles for the public site and authenticated workspaces. The interface follows the original Tridash prototype's visual language: Space Grotesk headings, Inter interface text, JetBrains Mono metadata, deep green primary surfaces, signal green, amber actions, pale-green backgrounds, white cards and rounded controls.

## Requirements

Install the following before running the project:

- Node.js 20 or later
- npm
- PostgreSQL database
- Firebase project configured for Authentication
- Mapbox access token
- Paystack test or live credentials, depending on the environment

## Run locally

Run the backend and frontend in separate terminals from the project root.

### 1. Configure the backend environment

Create the local environment file:

```bash
cp server/.env.example server/.env
```

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

- `VITE_API_URL` — public backend API origin.
- `VITE_TRIDASH_DEPLOYMENT` — deployment mode (`combined`, `public` or the configured app mode).
- `VITE_TRIDASH_APP_URL` — authenticated application origin used by public-site sign-in and registration links.

The public and application production hosts are also distinguished by hostname in `src/main.tsx`.

## Deployment overview

A split deployment can host the frontend on a static web host, the backend on a Node-compatible service and PostgreSQL on a managed database provider.

1. Configure the production database and backend environment variables.
2. Run `npx prisma generate` and `npx prisma migrate deploy` in the backend deployment process.
3. Build the frontend with `npm run build` and publish the `dist/` directory.
4. Set `VITE_API_URL` to the backend origin and configure the frontend origin in the backend's `FRONTEND_URL`.
5. Configure Firebase authorized domains, Paystack callback URLs, Mapbox token restrictions and HTTPS/WSS.
6. Configure the frontend host to serve `index.html` for client-side routes so direct navigation and page refreshes work.
7. Test authentication, ride requests, driver acceptance, trip status updates, payments, notifications, administrator review and sign-out on the deployed services.

## Quality checks

Run the frontend production build and backend TypeScript build before deployment:

```bash
npm run build
```

```bash
cd server
npm run build
```

The project uses four-space indentation. Keep the code organised into reusable components, API modules, backend routes, services and utilities. This repository's project documentation is maintained in this `README.md` file.
