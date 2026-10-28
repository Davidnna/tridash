import prisma from './database';

/**
 * Additive-only compatibility schema for staged authentication migration.
 * Existing Firebase accounts and ride data are preserved.
 */
export async function ensureAuthSchema() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User"
      ADD COLUMN IF NOT EXISTS "passwordHash" TEXT,
      ADD COLUMN IF NOT EXISTS "googleSubject" TEXT,
      ADD COLUMN IF NOT EXISTS "emailVerificationTokenHash" TEXT,
      ADD COLUMN IF NOT EXISTS "emailVerificationExpiresAt" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "passwordResetTokenHash" TEXT,
      ADD COLUMN IF NOT EXISTS "passwordResetExpiresAt" TIMESTAMP(3)
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_googleSubject_key" ON "User"("googleSubject")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_emailVerificationTokenHash_key" ON "User"("emailVerificationTokenHash")`);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "User_passwordResetTokenHash_key" ON "User"("passwordResetTokenHash")`);
}
