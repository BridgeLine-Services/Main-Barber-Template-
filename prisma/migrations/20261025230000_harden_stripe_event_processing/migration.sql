-- Make webhook processing state explicit so failures are retryable without
-- treating a claimed-but-incomplete event as successfully handled.
CREATE TYPE "StripeEventStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "StripeEvent"
  ADD COLUMN "status" "StripeEventStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "failure" TEXT;

ALTER TABLE "StripeEvent" ALTER COLUMN "status" SET DEFAULT 'PROCESSING';
