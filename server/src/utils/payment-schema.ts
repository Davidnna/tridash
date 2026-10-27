import prisma from './database';

// Additive compatibility migration for databases that were created with
// Prisma db push or moved to a new provider without the latest migration.
// Safe to run repeatedly: it only adds a nullable column if it is missing.
let paymentSchemaReady: Promise<void> | null = null;

export function ensurePaymentCheckoutSchema(): Promise<void> {
  if (!paymentSchemaReady) {
    paymentSchemaReady = prisma.$executeRawUnsafe(
      'ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "authorizationUrl" TEXT'
    ).then(() => undefined).catch((error) => {
      paymentSchemaReady = null;
      throw error;
    });
  }

  return paymentSchemaReady;
}
