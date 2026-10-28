import prisma from './database';

// Additive compatibility migration for databases that were created with
// Prisma db push or moved to a new provider without the latest migration.
// Safe to run repeatedly: it only adds nullable columns if they are missing.
let runtimeSchemaReady: Promise<void> | null = null;

export function ensureRuntimeSchema(): Promise<void> {
  if (!runtimeSchemaReady) {
    runtimeSchemaReady = (async () => {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "authorizationUrl" TEXT'
      );
      // Additive fields for the Tridash-owned auth migration. Existing Firebase
      // identifiers remain nullable so legacy accounts can transition safely.
      await prisma.$executeRawUnsafe('ALTER TABLE "User" ALTER COLUMN "firebaseUid" DROP NOT NULL');
      await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleSub" TEXT');
      await prisma.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT');
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "User_googleSub_key" ON "User"("googleSub")');
      await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "AuthToken" ("id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id"))');
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AuthToken_userId_idx" ON "AuthToken"("userId")');
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AuthToken_type_expiresAt_idx" ON "AuthToken"("type", "expiresAt")');
      await prisma.$executeRawUnsafe('DO $ BEGIN ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $');
      // These columns were added in a later Ride migration. The previous Neon
      // schema mismatch shows migration history may say "applied" even when a
      // column is absent, so reconcile these additive fields before serving.
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "driverVehicleMake" TEXT'
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "driverVehicleModel" TEXT'
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "driverVehicleColor" TEXT'
      );
    })().catch((error) => {
      runtimeSchemaReady = null;
      throw error;
    });
  }

  return runtimeSchemaReady;
}
