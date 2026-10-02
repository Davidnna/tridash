# Tridash Migration Progress

**Date:** October 1, 2026
**Status:** In Progress

## Overview
Migrating Tridash from AppDeploy platform to portable Express + PostgreSQL stack.

## ✅ Completed

### 1. Backend Setup
- ✅ Created `/server` directory with npm initialization
- ✅ Installed production dependencies:
  - express, cors, dotenv
  - @prisma/client, pg (PostgreSQL)
  - firebase-admin (auth)
  - socket.io (WebSocket)
  - bcrypt, jsonwebtoken, cookie-parser
- ✅ Created Prisma schema (`server/prisma/schema.prisma`)
  - 11 models: User, Session, Profile, Driver, Ride, Rating, Payment, Notification, Incident, TripShare, EntitySubscription
  - Full relationship mapping from AppDeploy structure
- ✅ Created TypeScript config
- ✅ Created `.env.example` with all required secrets
- ✅ Updated package.json with dev/build/start scripts
- ✅ Created directory structure: routes, middleware, utils, services

### 2. Database Design
- ✅ PostgreSQL schema matches AppDeploy's table structure
- ✅ Proper foreign keys and relationships
- ✅ Indexes for performance
- ✅ Support for JSON fields (coords, lastLocation)

## 🚧 In Progress

### Dev Dependencies Installation
- Background task installing: prisma, typescript, @types packages, ts-node, nodemon
- Required to run Prisma migrations and TypeScript compilation

## 📋 Next Steps

### 1. Complete Backend (Task #2, #3)
- [ ] Wait for dev dependencies to finish installing
- [ ] Run `npx prisma generate` to generate Prisma Client
- [ ] Create database (local PostgreSQL or cloud: Supabase/Neon)
- [ ] Run `npx prisma migrate dev` to create tables
- [ ] Create Express server files:
  - `src/index.ts` - Main server entry
  - `src/middleware/auth.ts` - JWT + Firebase auth
  - `src/routes/auth.ts` - Login/logout/session
  - `src/routes/rides.ts` - Ride CRUD
  - `src/routes/drivers.ts` - Driver management
  - `src/routes/payments.ts` - Paystack integration
  - `src/services/websocket.ts` - Socket.io setup
  - `src/services/notifications.ts` - Firebase push notifications
  - `src/utils/database.ts` - Prisma client singleton

### 2. Update Frontend (Task #4)
- [ ] Remove `@appdeploy/client` imports
- [ ] Create `src/api/client.ts` - Axios wrapper for HTTP calls
- [ ] Create `src/api/websocket.ts` - Socket.io-client setup
- [ ] Update all API calls to use new client
- [ ] Fix duplicate email key bug in `App.tsx:220`

### 3. Remove AppDeploy Code (Task #1)
- [ ] Delete `backend/` directory (old AppDeploy code)
- [ ] Remove `appdeploy.auth-login.json`
- [ ] Update README with new setup instructions

### 4. Testing & Deployment
- [ ] Test locally: frontend → Express backend → PostgreSQL
- [ ] Set up environment variables
- [ ] Deploy backend (Railway, Render, fly.io, or VPS)
- [ ] Deploy frontend (Vercel, Netlify, or static hosting)
- [ ] Configure CORS and security headers

## Migration Benefits

✅ **Platform Independence** - Can deploy anywhere (AWS, GCP, Azure, VPS)
✅ **Standard Tech Stack** - Express, PostgreSQL, Socket.io (widely supported)
✅ **Cost Control** - Not locked into AppDeploy pricing
✅ **Full Control** - Access to database, logs, infrastructure
✅ **Easy Scaling** - Standard load balancing, database replicas

## Technical Decisions

| Component | AppDeploy | New Stack |
|-----------|-----------|-----------|
| Backend Framework | @appdeploy/sdk router | **Express.js** |
| Database | AppDeploy db | **PostgreSQL + Prisma** |
| Auth | Built-in + Firebase | **Firebase Admin + JWT** |
| WebSockets | AppDeploy ws | **Socket.io** |
| Secrets | AppDeploy secrets | **.env files** |
| Notifications | AppDeploy notifications | **Firebase Cloud Messaging** |
| Payments | Paystack (unchanged) | **Paystack** |
| Maps | Mapbox (unchanged) | **Mapbox** |

## Estimated Time Remaining

- Backend implementation: 3-4 hours
- Frontend updates: 2-3 hours
- Testing & debugging: 1-2 hours
- **Total: 6-9 hours**

## Questions to Answer

1. **Database hosting?**
   - Local PostgreSQL for dev
   - Supabase free tier (recommended for easy start)
   - Neon free tier (good alternative)
   - Self-hosted (VPS, AWS RDS)

2. **Backend hosting?**
   - Railway (easiest, free tier)
   - Render (good free tier)
   - fly.io (global edge)
   - VPS (Digital Ocean, Linode)

3. **Do you have access to Firebase project?**
   - Need service account JSON for backend
   - Need config for frontend

4. **Do you have Paystack & Mapbox keys?**
   - Required for payments and maps

---

**Next Action:** Wait for dev dependencies to complete, then continue building the Express server.
