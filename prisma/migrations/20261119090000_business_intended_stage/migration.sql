-- Part 4.2: record the business stage an owner says they are heading for.
-- Additive, nullable, no default rewrite, no data change. Reversible by dropping
-- the column. Nothing reads it as a permission.
ALTER TABLE "Business" ADD COLUMN "intendedStage" TEXT;
