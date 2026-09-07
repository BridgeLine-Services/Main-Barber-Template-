-- Include RESCHEDULED appointments in the appointment overlap constraint.
-- RESCHEDULED represents an active appointment waiting to be confirmed at a new time,
-- so it must participate in overlap protection like PENDING and CONFIRMED.

-- Drop the old constraint
ALTER TABLE "Appointment"
DROP CONSTRAINT "Appointment_no_active_overlap";

-- Add the new constraint that includes RESCHEDULED
ALTER TABLE "Appointment"
ADD CONSTRAINT "Appointment_no_active_overlap"
EXCLUDE USING GIST (
  "businessId" WITH =,
  "barberId" WITH =,
  tstzrange("startTime", "endTime", '[)') WITH &&
)
WHERE ("status" IN ('PENDING', 'CONFIRMED', 'RESCHEDULED'));
