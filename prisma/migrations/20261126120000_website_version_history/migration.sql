-- Append-only website version history. Additive: no existing row is touched, and the
-- published content continues to live on WebsiteContent exactly as before.
CREATE TABLE "WebsiteContentVersion" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "summary" TEXT,
    "authorId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteContentVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteContentVersion_businessId_version_key" ON "WebsiteContentVersion"("businessId", "version");
CREATE INDEX "WebsiteContentVersion_businessId_version_idx" ON "WebsiteContentVersion"("businessId", "version");

ALTER TABLE "WebsiteContentVersion" ADD CONSTRAINT "WebsiteContentVersion_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A restore is its own auditable act, distinct from publishing. Added as a new value so
-- existing audit rows keep their original meaning.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'WEBSITE_VERSION_RESTORED_TO_DRAFT';
