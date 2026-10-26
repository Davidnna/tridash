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
