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
