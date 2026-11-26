ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Ride" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);

ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "assignedToId" TEXT;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "Incident" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "Tricycle" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "registrationDetails" TEXT NOT NULL DEFAULT '',
    "verificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Tricycle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Tricycle_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("userId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tricycle_plateNumber_key" ON "Tricycle"("plateNumber");
CREATE INDEX IF NOT EXISTS "Tricycle_driverId_idx" ON "Tricycle"("driverId");
CREATE INDEX IF NOT EXISTS "Tricycle_verificationStatus_idx" ON "Tricycle"("verificationStatus");
CREATE INDEX IF NOT EXISTS "Tricycle_status_idx" ON "Tricycle"("status");

CREATE TABLE IF NOT EXISTS "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "Incident_status_idx" ON "Incident"("status");
CREATE INDEX IF NOT EXISTS "Incident_createdAt_idx" ON "Incident"("createdAt");

-- Backfill the independent vehicle register from existing driver profile data.
INSERT INTO "Tricycle" (
    "id", "driverId", "plateNumber", "make", "model", "color",
    "registrationDetails", "verificationStatus", "status", "createdAt", "updatedAt"
)
SELECT
    md5(random()::text || clock_timestamp()::text),
    d."userId",
    upper(trim(d."tricycle")),
    COALESCE(NULLIF(trim(d."vehicleMake"), ''), 'Not supplied'),
    COALESCE(NULLIF(trim(d."vehicleModel"), ''), 'Not supplied'),
    COALESCE(NULLIF(trim(d."vehicleColor"), ''), 'Not supplied'),
    '',
    CASE WHEN d."verified" THEN 'verified' ELSE 'pending' END,
    CASE WHEN d."status" = 'suspended' THEN 'suspended' ELSE 'active' END,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Driver" d
WHERE trim(COALESCE(d."tricycle", '')) <> ''
ON CONFLICT ("plateNumber") DO NOTHING;
