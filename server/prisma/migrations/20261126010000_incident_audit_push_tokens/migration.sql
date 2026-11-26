
-- Reconcile legacy driver and vehicle states with account status and complete vehicle details.
UPDATE "Driver"
SET "verified" = FALSE,
    "online" = FALSE,
    "status" = CASE WHEN "status" IN ('inactive', 'suspended') THEN "status" ELSE 'pending' END,
    "verificationStatus" = CASE WHEN "verificationStatus" = 'rejected' THEN 'rejected' ELSE 'pending_review' END,
    "vehicleStatus" = 'pending'
WHERE "verified" = TRUE
    AND (
        trim(COALESCE("tricycle", '')) = ''
        OR trim(COALESCE("vehicleMake", '')) = ''
        OR trim(COALESCE("vehicleModel", '')) = ''
        OR trim(COALESCE("vehicleColor", '')) = ''
    );

UPDATE "Driver" d
SET "status" = CASE
    WHEN u."status" = 'inactive' THEN 'inactive'
    WHEN u."status" = 'suspended' THEN 'suspended'
    WHEN u."status" = 'active' AND d."verified" = TRUE AND d."status" = 'pending' THEN 'active'
    ELSE d."status"
END,
"online" = CASE
    WHEN u."status" <> 'active' OR d."status" IN ('inactive', 'suspended') OR d."verified" = FALSE
        OR trim(COALESCE(d."tricycle", '')) = ''
        OR trim(COALESCE(d."vehicleMake", '')) = ''
        OR trim(COALESCE(d."vehicleModel", '')) = ''
        OR trim(COALESCE(d."vehicleColor", '')) = ''
    THEN FALSE ELSE d."online" END
FROM "User" u
WHERE d."userId" = u."id";

UPDATE "Driver"
SET "vehicleStatus" = CASE
    WHEN "verified" = TRUE
        AND trim(COALESCE("tricycle", '')) <> ''
        AND trim(COALESCE("vehicleMake", '')) <> ''
        AND trim(COALESCE("vehicleModel", '')) <> ''
        AND trim(COALESCE("vehicleColor", '')) <> ''
    THEN 'verified'
    ELSE 'pending'
END;

UPDATE "Driver"
SET "verificationStatus" = 'verified'
WHERE "verified" = TRUE AND "vehicleStatus" = 'verified';

UPDATE "Driver"
SET "verificationStatus" = 'pending_review'
WHERE "verified" = FALSE AND "verificationStatus" = 'verified';

UPDATE "Tricycle" t
SET "verificationStatus" = CASE
        WHEN d."verified" = TRUE
            AND trim(COALESCE(d."tricycle", '')) <> ''
            AND trim(COALESCE(d."vehicleMake", '')) <> ''
            AND trim(COALESCE(d."vehicleModel", '')) <> ''
            AND trim(COALESCE(d."vehicleColor", '')) <> ''
        THEN 'verified'
        ELSE 'pending'
    END,
    "status" = CASE WHEN d."status" IN ('inactive', 'suspended') THEN d."status" ELSE t."status" END
FROM "Driver" d
WHERE t."driverId" = d."userId";

ALTER TABLE "Incident"
    ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'other',
    ADD COLUMN IF NOT EXISTS "reportedUserId" TEXT;

CREATE INDEX IF NOT EXISTS "Incident_reportedUserId_idx" ON "Incident"("reportedUserId");

DO $$ BEGIN
    ALTER TABLE "Incident"
        ADD CONSTRAINT "Incident_reportedUserId_fkey"
        FOREIGN KEY ("reportedUserId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "IncidentActivity" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentActivity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IncidentActivity_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IncidentActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "IncidentActivity_incidentId_createdAt_idx" ON "IncidentActivity"("incidentId", "createdAt");
CREATE INDEX IF NOT EXISTS "IncidentActivity_actorId_idx" ON "IncidentActivity"("actorId");

CREATE TABLE IF NOT EXISTS "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX IF NOT EXISTS "PushToken_userId_idx" ON "PushToken"("userId");

DO $$ BEGIN
    ALTER TABLE "Incident"
        ADD CONSTRAINT "Incident_assignedToId_fkey"
        FOREIGN KEY ("assignedToId") REFERENCES "User"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Ride" ALTER COLUMN "paymentMethod" SET DEFAULT 'Cash';
