-- Evidence-gated removal of DRAFT review-request objects
-- (docs/MIGRATION-RECOVERY.md, Case C). The build reaches this file ONLY
-- after a read-only verification proved the database holds exactly the
-- draft shape: the draft ReviewRequestStatus enum values, the draft
-- ReviewRequest column set, ZERO rows, no retention review columns, and
-- no objects from any later migration. The re-checks below are defense in
-- depth — if the table unexpectedly holds rows, nothing is dropped and
-- the deployment stops. With the draft objects gone, migration
-- 20261017170000_automated_review_requests can be applied for real.
DO $$
DECLARE row_count bigint;
BEGIN
  IF to_regclass('public."ReviewRequest"') IS NOT NULL THEN
    SELECT count(*) INTO row_count FROM "ReviewRequest";
    IF row_count > 0 THEN
      RAISE EXCEPTION 'ReviewRequest holds % row(s): refusing to drop draft objects', row_count;
    END IF;
    DROP TABLE "ReviewRequest";
  END IF;
  DROP TYPE IF EXISTS "ReviewRequestStatus";
END $$;
