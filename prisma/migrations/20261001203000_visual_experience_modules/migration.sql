-- Visual experience system: Before/After transformations, homepage module
-- config, and per-asset focal points.
--
-- Tenant safety: BeforeAfterPair carries a direct businessId (RLS tenant
-- key) and is added to prisma/rls/production-rls.sql in the same change.

-- 1. Owner-curated before/after image pairs (tenant-scoped)
CREATE TABLE "BeforeAfterPair" (
    "id"             TEXT NOT NULL,
    "businessId"     TEXT NOT NULL,
    "beforeAssetId"  TEXT NOT NULL,
    "afterAssetId"   TEXT NOT NULL,
    "barberId"       TEXT,
    "serviceId"      TEXT,
    "caption"        TEXT,
    "details"        TEXT,
    "sortOrder"      INTEGER NOT NULL DEFAULT 0,
    "isPublished"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BeforeAfterPair_pkey" PRIMARY KEY ("id")
);

-- 2. Focal points on media assets (percent 0-100; NULL = center)
ALTER TABLE "MediaAsset" ADD COLUMN "focalX" INTEGER,
                        ADD COLUMN "focalY" INTEGER;

-- 3. Unified homepage module configuration (draft; published via snapshot)
ALTER TABLE "WebsiteContent" ADD COLUMN "homeModules" JSONB;

-- CreateIndex
CREATE INDEX "BeforeAfterPair_businessId_isPublished_sortOrder_idx"
    ON "BeforeAfterPair"("businessId", "isPublished", "sortOrder");
CREATE INDEX "BeforeAfterPair_barberId_idx" ON "BeforeAfterPair"("barberId");
CREATE INDEX "BeforeAfterPair_serviceId_idx" ON "BeforeAfterPair"("serviceId");

-- AddForeignKey
ALTER TABLE "BeforeAfterPair"
  ADD CONSTRAINT "BeforeAfterPair_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeforeAfterPair"
  ADD CONSTRAINT "BeforeAfterPair_beforeAssetId_fkey"
  FOREIGN KEY ("beforeAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeforeAfterPair"
  ADD CONSTRAINT "BeforeAfterPair_afterAssetId_fkey"
  FOREIGN KEY ("afterAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BeforeAfterPair"
  ADD CONSTRAINT "BeforeAfterPair_barberId_fkey"
  FOREIGN KEY ("barberId") REFERENCES "Barber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BeforeAfterPair"
  ADD CONSTRAINT "BeforeAfterPair_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
