-- Prevent overlapping active appointments at the database level.
-- btree_gist enables equality operators for text columns in the GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_no_active_overlap"
EXCLUDE USING GIST (
  "businessId" WITH =,
  "barberId" WITH =,
  tsrange("startTime", "endTime", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED'));
