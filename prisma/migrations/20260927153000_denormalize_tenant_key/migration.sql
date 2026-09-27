-- Requirement 9 (follow-up): denormalize the tenant key onto the three
-- indirectly-scoped tables (BarberService, BarberRewardProgram,
-- AppointmentIntakeResponse) so PostgreSQL RLS policies can key on it.
-- The key is maintained by triggers (below), so it can never drift from
-- the parent record regardless of which code path performs the write.

-- 1. Add the nullable tenant key column
ALTER TABLE "BarberService"           ADD COLUMN "businessId" TEXT;
ALTER TABLE "BarberRewardProgram"     ADD COLUMN "businessId" TEXT;
ALTER TABLE "AppointmentIntakeResponse" ADD COLUMN "businessId" TEXT;

-- 2. Backfill from the parent records
UPDATE "BarberService" bs SET "businessId" = b."businessId"
  FROM "Barber" b WHERE bs."barberId" = b."id";
UPDATE "BarberRewardProgram" rp SET "businessId" = b."businessId"
  FROM "Barber" b WHERE rp."barberId" = b."id";
UPDATE "AppointmentIntakeResponse" ir SET "businessId" = a."businessId"
  FROM "Appointment" a WHERE ir."appointmentId" = a."id";

-- 3. Keep the key in sync automatically (insert + parent re-link)
CREATE OR REPLACE FUNCTION "sync_BarberService_businessId"() RETURNS trigger AS $$
BEGIN
  SELECT b."businessId" INTO NEW."businessId" FROM "Barber" b WHERE b."id" = NEW."barberId";
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "sync_BarberRewardProgram_businessId"() RETURNS trigger AS $$
BEGIN
  SELECT b."businessId" INTO NEW."businessId" FROM "Barber" b WHERE b."id" = NEW."barberId";
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "sync_AppointmentIntakeResponse_businessId"() RETURNS trigger AS $$
BEGIN
  SELECT a."businessId" INTO NEW."businessId" FROM "Appointment" a WHERE a."id" = NEW."appointmentId";
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "BarberService_tenant_sync"
  BEFORE INSERT OR UPDATE OF "barberId" ON "BarberService"
  FOR EACH ROW EXECUTE FUNCTION "sync_BarberService_businessId"();
CREATE TRIGGER "BarberRewardProgram_tenant_sync"
  BEFORE INSERT OR UPDATE OF "barberId" ON "BarberRewardProgram"
  FOR EACH ROW EXECUTE FUNCTION "sync_BarberRewardProgram_businessId"();
CREATE TRIGGER "AppointmentIntakeResponse_tenant_sync"
  BEFORE INSERT OR UPDATE OF "appointmentId" ON "AppointmentIntakeResponse"
  FOR EACH ROW EXECUTE FUNCTION "sync_AppointmentIntakeResponse_businessId"();

-- 4. Referential integrity + lookup index for RLS policies
ALTER TABLE "BarberService"           ADD CONSTRAINT "BarberService_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE;
ALTER TABLE "BarberRewardProgram"     ADD CONSTRAINT "BarberRewardProgram_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE;
ALTER TABLE "AppointmentIntakeResponse" ADD CONSTRAINT "AppointmentIntakeResponse_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE;

CREATE INDEX "BarberService_businessId_idx"           ON "BarberService"("businessId");
CREATE INDEX "BarberRewardProgram_businessId_idx"     ON "BarberRewardProgram"("businessId");
CREATE INDEX "AppointmentIntakeResponse_businessId_idx" ON "AppointmentIntakeResponse"("businessId");
