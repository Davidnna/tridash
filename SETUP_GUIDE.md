# Tridash Migration - Complete Setup Guide

## Current Status
We're migrating your Tridash app from AppDeploy to a portable stack. The npm installation hit Windows file system lock issues (common with deep node_modules). 

## Quick Fix for Installation Issue

### Option 1: Use pnpm (Recommended for Windows)
```bash
# Install pnpm globally
npm install -g pnpm

# Navigate to server directory
cd "C:/Users/daved/Documents/Claude Code/tridash-local/server"

# Clean and reinstall
rm -rf node_modules package-lock.json
pnpm install
```

### Option 2: Use yarn
```bash
npm install -g yarn
cd "C:/Users/daved/Documents/Claude Code/tridash-local/server"
rm -rf node_modules package-lock.json
yarn install
```

### Option 3: npm with --legacy-peer-deps
```bash
cd "C:/Users/daved/Documents/Claude Code/tridash-local/server"
# Close all terminals, VS Code, etc. that might lock files
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

## Complete Setup Steps

### 1. Database Setup

**Option A: Use Supabase (Easiest, Free)**
1. Go to https://supabase.com
2. Create account and new project
3. Get database URL from Settings → Database → Connection String
4. Copy to `.env` file

**Option B: Local PostgreSQL**
```bash
# Install PostgreSQL from https://www.postgresql.org/download/windows/
# Or use Docker:
docker run --name tridash-postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=tridash -p 5432:5432 -d postgres:15
```

### 2. Environment Variables

Create `server/.env` file:
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/tridash"
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
JWT_SECRET=your-super-secret-jwt-key-change-this
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project-id.iam.gserviceaccount.com
# Preserve the private key's line breaks as literal \n characters.
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
MAPBOX_PUBLIC_TOKEN=your_mapbox_token
PAYSTACK_SECRET_KEY=your_paystack_key
SUPER_ADMIN_EMAIL=davedozie1@gmail.com
```

### 3. Run Database Migrations

```bash
cd server
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Start Backend

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
npm start
```

### 5. Update Frontend

The frontend needs to be updated to remove `@appdeploy/client`. I'll create the files for this next.

### 6. Start Frontend

```bash
cd .. # Back to root
npm run dev
```

## What I'm Creating for You

✅ Complete Express server with all routes
✅ Authentication middleware (Firebase + JWT)
✅ WebSocket setup (Socket.io)
✅ Database utilities (Prisma)
✅ All API endpoints matching AppDeploy structure
✅ Frontend API client (replacing @appdeploy/client)

## Files Created So Far

- ✅ `server/prisma/schema.prisma` - Database schema
- ✅ `server/tsconfig.json` - TypeScript config
- ✅ `server/.env.example` - Environment template
- ✅ `server/package.json` - Dependencies and scripts
- ✅ `server/src/index.ts` - Main server file

## Files Being Created Next

- `server/src/middleware/auth.ts` - Authentication
- `server/src/routes/*.ts` - All API routes
- `server/src/services/websocket.ts` - Real-time updates
- `server/src/utils/*.ts` - Helper functions
- `src/api/client.ts` - Frontend API wrapper
- `src/api/websocket.ts` - Frontend WebSocket client

## Troubleshooting

**"Prisma command not found"**
- Run: `npx prisma` instead of `prisma`

**"Cannot connect to database"**
- Check DATABASE_URL in .env
- Ensure PostgreSQL is running
- Test: `psql $DATABASE_URL`

**"Port 3001 already in use"**
- Change PORT in .env
- Or kill process: `netstat -ano | findstr :3001` then `taskkill /PID <pid> /F`

**Frontend can't connect to backend**
- Check CORS settings in server/src/index.ts
- Ensure FRONTEND_URL in .env matches your frontend URL
- Check backend is running on correct port

## Next Steps

1. Fix npm installation using one of the options above
2. Set up database (Supabase or local PostgreSQL)
3. Add environment variables
4. Run migrations
5. I'll continue creating all the backend route files
6. Then update the frontend to remove AppDeploy dependencies

Let me know when you're ready to continue!

