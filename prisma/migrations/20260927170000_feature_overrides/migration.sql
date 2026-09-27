-- Requirement 27: centralized, tenant-aware feature configuration.
-- Sparse JSON map of feature key -> boolean on each Business row.
-- Resolution, defaults and validation live in src/lib/features.ts.
ALTER TABLE "Business" ADD COLUMN "featureOverrides" JSONB;
