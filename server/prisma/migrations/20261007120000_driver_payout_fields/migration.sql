-- Add Paystack payout fields to Driver for split payments
ALTER TABLE "Driver" ADD COLUMN "payoutBankName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "payoutBankCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN "payoutAccountNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "payoutAccountName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "payoutSubaccountCode" TEXT NOT NULL DEFAULT '';
