ALTER TABLE "Driver"
    ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "otherNames" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "dateOfBirth" TIMESTAMP(3),
    ADD COLUMN "operatingState" TEXT NOT NULL DEFAULT 'Ebonyi',
    ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'incomplete',
    ADD COLUMN "identityStatus" TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN "licenseStatus" TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN "vehicleStatus" TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN "faceStatus" TEXT NOT NULL DEFAULT 'not_started';

CREATE TABLE "DriverVerificationDocument" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "extractedData" JSONB,
    "automatedChecks" JSONB,
    "providerName" TEXT NOT NULL DEFAULT '',
    "providerReference" TEXT NOT NULL DEFAULT '',
    "expiryDate" TIMESTAMP(3),
    "reviewReason" TEXT NOT NULL DEFAULT '',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DriverVerificationDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DriverVerificationDocument_storageKey_key" ON "DriverVerificationDocument"("storageKey");
CREATE INDEX "DriverVerificationDocument_driverId_idx" ON "DriverVerificationDocument"("driverId");
CREATE INDEX "DriverVerificationDocument_documentType_status_idx" ON "DriverVerificationDocument"("documentType", "status");
ALTER TABLE "DriverVerificationDocument" ADD CONSTRAINT "DriverVerificationDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the approval state of existing accounts while new applications use the stricter workflow.
UPDATE "Driver" SET "verificationStatus" = 'verified' WHERE "verified" = TRUE;
UPDATE "Driver" SET "verificationStatus" = 'pending_review' WHERE "verified" = FALSE;
