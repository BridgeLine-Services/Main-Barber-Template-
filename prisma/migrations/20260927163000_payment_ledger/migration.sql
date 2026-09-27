-- Requirement 23: provider-agnostic payment ledger (pay-at-shop now,
-- online provider later — see src/lib/payments/ and docs/PAYMENTS.md).
-- Stores provider references only; card data never touches this table.

CREATE TYPE "PaymentKind" AS ENUM ('CHARGE', 'DEPOSIT', 'TIP', 'REFUND');
CREATE TYPE "PaymentMethod" AS ENUM ('IN_PERSON', 'CARD');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');

CREATE TABLE "Payment" (
    "id"                TEXT        NOT NULL,
    "businessId"        TEXT        NOT NULL,
    "appointmentId"     TEXT,
    "customerId"        TEXT,
    "kind"              "PaymentKind"   NOT NULL,
    "method"            "PaymentMethod" NOT NULL,
    "provider"          TEXT        NOT NULL,
    "providerRefId"     TEXT,
    "amount"            DOUBLE PRECISION NOT NULL,
    "currency"          TEXT        NOT NULL DEFAULT 'USD',
    "status"            "PaymentStatus"  NOT NULL DEFAULT 'PENDING',
    "failureReason"     TEXT,
    "idempotencyKey"    TEXT,
    "metadata"          JSONB,
    "originalPaymentId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");
CREATE INDEX "Payment_businessId_idx"          ON "Payment"("businessId");
CREATE INDEX "Payment_appointmentId_idx"       ON "Payment"("appointmentId");
CREATE INDEX "Payment_customerId_idx"          ON "Payment"("customerId");
CREATE INDEX "Payment_businessId_status_idx"   ON "Payment"("businessId", "status");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_originalPaymentId_fkey"
  FOREIGN KEY ("originalPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
