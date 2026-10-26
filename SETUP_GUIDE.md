# Tridash — Local Development and Deployment Guide

This project is a portable Vite + React frontend with an Express + Socket.IO backend, PostgreSQL, Prisma, Firebase Authentication, Mapbox, and Paystack.

## Run locally

Open two terminals from the Tridash project root directory.

### Backend

```bash
cd server
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

The API and Socket.IO server run on `http://localhost:3001`.

### Frontend

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`. Routes use normal browser paths such as `/request` and `/trips`.

## Driver verification setup

Driver verification now supports separate first/last/other names, date of birth, operating state (initially Ebonyi), private document uploads, document status tracking, expiry/consistency checks when extracted fields are available, and an admin review queue. The required documents are government ID, driving licence, and vehicle registration. A selfie upload is available for a future face-match/liveness integration. Drivers cannot go online or be approved until required documents are marked verified.

After deploying this version, run `npx prisma migrate deploy` from `server` to add the verification fields and `DriverVerificationDocument` table. Set `DRIVER_DOCUMENT_STORAGE_DIR` to a **private, persistent volume** on the backend host and set `DRIVER_DOCUMENT_ENCRYPTION_KEY` to a securely stored 32-byte hex key (generate with `openssl rand -hex 32`). Production uploads are rejected if the encryption key is missing. Do not expose the upload directory as static files or commit uploaded documents. The default path is for local development only; ephemeral production disks can lose files during redeploys. Back up the encrypted volume and encryption key separately and restrict access to both.

Automated OCR and official registry checks are adapter-based and intentionally fail closed. Without provider configuration, uploads are stored securely and placed in the admin review queue; they are not falsely marked as officially verified. Optional environment variables and the JSON adapter contract are documented in `server/.env.example`. Configure only authorised providers, obtain the required consent, and test provider responses before enabling automatic approval. A manual admin decision must include a review note for audit purposes.

### Phone number format

The driver verification form now collects a country calling code separately from the national number. It stores the combined number in international E.164-style format (for example `+2348031234567`) and validates it on the backend. Nigeria (+234) is the default, with a starter list of other country codes that can be expanded as Tridash launches in additional markets. Existing local-format phone numbers are interpreted as Nigerian numbers when loaded into this form; ask drivers to confirm the number before saving.

### Setting up document and identity verification providers

Do this in stages. Do not put vendor API secrets in the frontend, and do not set a provider URL until the backend adapter has been checked against that vendor's current API documentation and test responses.

1. **Choose and contract the providers.** Request sandbox access, current API documentation, pricing, rate limits, data-processing terms, retention/deletion rules, security certifications, service availability, support contacts and a production approval process. Confirm that the provider is legally authorised to access each government data source and that Tridash's intended use is permitted.
2. **OCR/document reading.** Select an OCR/document-extraction service that can read the actual Nigerian ID, FRSC licence and vehicle-registration formats we expect. Create a backend-only adapter for `DOCUMENT_OCR_API_URL`. Tridash sends `{documentType,mimeType,base64}` and expects JSON containing `fields`, such as `firstName`, `lastName`, `otherNames`, `dateOfBirth`, `documentNumber`, `expiryDate`, `registrationNumber`, `vin`, `make` and `model`. A generic OCR product may extract text but may not identify all these fields reliably; test with representative, consented sample documents and route uncertain results to review.
3. **Government ID / NIN.** NIMC says enterprise NINAuth access is facilitated through approved Identity Verification Partners and requires informed consent, access controls and NDPA compliance. Start at https://ninauth.nimc.gov.ng/enterprises and review https://ninauth.nimc.gov.ng/approved-partners. Select a partner from the official list and agree access and pricing directly with it. Only then configure `GOVERNMENT_ID_VERIFICATION_API_URL` and its key through the backend secret manager. Do not send raw NIN data to an unapproved provider.
4. **Driver's licence / FRSC.** The public FRSC document portal supports licence/RID lookup, but the public material reviewed does not establish a general real-time API for third-party apps. Contact `verification@frsc.gov.ng` to ask what authorised digital integration or bulk verification options are available to a Nigerian ride-hailing company. Alternatively, assess a third-party licence-verification provider, confirming its source, permission to access FRSC data, response fields, auditability and terms. Do not scrape or automate the public portal. Configure `FRSC_VERIFICATION_API_URL` only when an approved integration exists.
5. **Vehicle registration.** Start with the official VREG service at https://vreg.gov.ng/ and confirm whether it offers a partner API for registration, certificate, VIN/chassis and ownership checks. The public site advertises vehicle information and certificate authentication, but that alone does not prove API access is available. If an authorised provider is contracted, configure `VEHICLE_REGISTRATION_VERIFICATION_API_URL`; otherwise keep this document in manual review.
6. **Face match and liveness.** Choose a provider that explicitly supports both comparison of the live capture to the ID portrait and liveness/anti-spoofing. A still selfie upload is not a liveness check. Obtain explicit, informed consent, define a retention/deletion period, restrict admin access, and offer a manual alternative for false rejects or accessibility issues. Configure `FACE_VERIFICATION_API_URL` only after the capture flow and backend adapter have been tested.
7. **Vehicle inspection, insurance and state permits.** Contact the relevant Ebonyi authorities/insurers to determine which documents are required for the exact tricycle service. Use `VEHICLE_INSPECTION_VERIFICATION_API_URL`, `VEHICLE_INSURANCE_VERIFICATION_API_URL` and `STATE_PERMIT_VERIFICATION_API_URL` only if the relevant authority/provider offers a permitted integration. Otherwise require documented manual review.
8. **Build/test each adapter.** Each configured verification URL must be a Tridash-compatible adapter endpoint, not merely a vendor website URL. The current adapter contract expects a JSON response with `verified: true` and `data`/`details` containing the matching document number, full name and date of birth for identity/licence checks; vehicle checks must return the matching registration number and VIN/chassis when supplied. The face adapter must return `faceMatchPassed: true` and `livenessPassed: true`. Adapt the provider's actual response to this contract server-side, reject incomplete/mismatched responses, record provider references and test positive, negative, expired, timeout and malformed-response cases before enabling automatic approvals.
9. **Set secrets in the backend host.** Add each URL/key in the backend deployment's Environment/Secrets settings, never in `VITE_*` frontend variables or source control. Start in sandbox mode. Confirm consent logging, access logging, retry limits, provider outage behaviour and deletion handling before production. Provider downtime or an inconclusive response must leave the application pending, not approved.

Useful official starting points (access and terms must be reconfirmed before launch):

- FRSC licence document verification: https://ndlverification.frsc.gov.ng/verify and contact `verification@frsc.gov.ng`.
- NINAuth enterprise access: https://ninauth.nimc.gov.ng/enterprises.
- NINAuth approved partners: https://ninauth.nimc.gov.ng/approved-partners.
- National Vehicle Registry: https://vreg.gov.ng/.

An OCR/identity vendor such as IdentityOrg publicly advertises OCR, driver's licence, NIN, face-match and liveness products and publishes indicative prices at https://identifyorg.com/pricing. Treat it as a candidate to evaluate, not as an endorsement or proof of government authorization: verify its current API documentation, security terms and official-partner status (especially for NIN) before sending real driver data.

## Environment variables

Create `server/.env` from `server/.env.example`. Never commit `.env` or credential files. For production, use a managed secret store. Set `FRONTEND_URL` to the exact public frontend origin.

## Deploy online

A practical split deployment is:

- **Frontend:** Vercel, Netlify, Cloudflare Pages, or any static host.
- **Backend:** Render, Railway, Fly.io, or a Node-compatible VPS.
- **Database:** Supabase, Neon, Railway PostgreSQL, or managed PostgreSQL.

### 1. Create production PostgreSQL

Create a PostgreSQL database and copy its connection string into the backend's `DATABASE_URL`. Run migrations from the server package during deployment:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run build
npm start
```

Do not use `prisma migrate dev` in production.

### 2. Deploy the backend

Configure these server environment variables in the hosting dashboard:

- `DATABASE_URL`
- `PORT` (the host-provided port is preferred)
- `NODE_ENV=production`
- `FRONTEND_URL=https://your-frontend-domain.example`
- `JWT_SECRET`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` with escaped `\\n` line breaks
- `MAPBOX_PUBLIC_TOKEN`
- `PAYSTACK_SECRET_KEY`
- `SUPER_ADMIN_EMAIL`

The backend must expose both HTTP and Socket.IO on the same public service URL. Use HTTPS/WSS in production. Confirm the host supports WebSocket upgrades and does not put the backend to sleep during active rides.

### 3. Deploy the frontend

Set the frontend build command to `npm run build` and publish the `dist` directory. Set `VITE_API_URL` to the public backend origin, for example `https://api.your-domain.example`.

Because this app uses `BrowserRouter`, configure an SPA fallback so every route serves `index.html`:

- Netlify: add `/* /index.html 200` to `public/_redirects`.
- Vercel: add a rewrite from `/(.*)` to `/` in `vercel.json` or use the framework's SPA configuration.
- Cloudflare Pages: include `dist/_redirects` with `/* /index.html 200`, or configure the Pages fallback.
- Nginx: use `try_files $uri $uri/ /index.html;`.

The frontend does not need the Paystack secret or Firebase Admin private key. Only use the Firebase web configuration and public Mapbox token in frontend variables.

### 4. Configure external services

- Add the production frontend domain to Firebase Authentication's authorized domains.
- Keep Firebase Admin values only on the backend.
- Configure Paystack callback URLs through the backend and use live keys only after testing.
- Restrict the Mapbox public token to the production domains where possible.
- Update backend CORS through `FRONTEND_URL` and verify credentials/cookies work over HTTPS.

### 5. Verify the deployment

1. Open the frontend root and refresh `/request` directly.
2. Sign in and confirm the backend creates a session cookie.
3. Confirm Socket.IO connects over WSS.
4. Request a ride, verify the route/fare preview, and test payment callback behavior.
5. Test driver and admin workspaces, notifications, and sign out.
6. Check the backend health endpoint at `/api/_healthcheck`.

## Troubleshooting

- If direct routes return 404, the host is missing the SPA fallback.
- If API calls fail, check `VITE_API_URL`, `FRONTEND_URL`, HTTPS, and credentials/CORS.
- If live updates fail, check WebSocket upgrade support and the public backend URL.
- If Prisma fails during deploy, verify `DATABASE_URL` and run `npx prisma migrate deploy` from `server`.

## Security note

The original AppDeploy runtime is no longer used. Never commit `.env` files, Firebase service-account JSON, or other credentials.


## Driver onboarding: vehicle and emergency details update

The driver onboarding form collects home address (with a device-location reverse-geocoding option), emergency contact (optional; name and phone must be entered together), vehicle make/model/colour, registration number, operating state and primary operating area. The home address, date of birth, identity documents and emergency contact are not included in the passenger-facing driver list. When a ride is accepted, the ride stores a snapshot of the assigned vehicle make/model/colour so the passenger can identify it.

After updating this version, apply all pending Prisma migrations with `npx prisma migrate deploy` from the server package/deployment context. Existing driver records will have blank values for the newly required vehicle and operating-area fields until the driver updates their onboarding form.

## Public website pages

The React app includes public, account-free pages at `/`, `/about`, `/how-it-works`, `/safety-info`, `/drive`, `/faq`, `/contact`, `/privacy`, and `/terms`. Sign-in and registration are available at `/login` and `/signup`; `/signup?role=driver` preselects driver registration. Shared trip links at `/shared-trip/:token` remain accessible without signing in. Passenger, driver, and admin workspaces remain behind authentication.

Before public launch, configure an official support channel and complete legal review of the privacy and terms pages. They are intentionally marked as drafts where operator-specific retention, contact, legal and jurisdictional details are not yet confirmed. Verify that the production host rewrites direct requests for client-side routes to `index.html` so public pages work when opened or refreshed by URL.
