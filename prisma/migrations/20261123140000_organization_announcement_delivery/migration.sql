-- Announcement delivery (Priority 3, part E): read receipts and the delivered set.
--
-- Additive only. One new column with a safe default, one new table, three indexes and two
-- foreign keys. Nothing existing is altered, renamed or dropped, and no row is deleted.
--
-- Why the column: the stored announcement holds the *declared* audience (for example
-- "region: West"), which is what a reader should see. Delivery needs the *resolved* set,
-- fixed at send time, because re-resolving a region later would quietly widen an
-- announcement that has already gone out. Rows written before this column existed default
-- to an empty set, which resolves to "delivered to nobody" and is therefore invisible
-- rather than accidentally sent to everyone. Nothing in the application wrote an
-- announcement before this migration, so no legitimate row is hidden by that default.

ALTER TABLE "OrganizationAnnouncement"
  ADD COLUMN "resolvedBusinessIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "OrganizationAnnouncementRead" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationAnnouncementRead_pkey" PRIMARY KEY ("id")
);

-- One receipt per person per announcement: a double-click cannot inflate read counts.
CREATE UNIQUE INDEX "OrganizationAnnouncementRead_announcementId_userId_key"
  ON "OrganizationAnnouncementRead"("announcementId", "userId");
CREATE INDEX "OrganizationAnnouncementRead_userId_readAt_idx"
  ON "OrganizationAnnouncementRead"("userId", "readAt");
CREATE INDEX "OrganizationAnnouncementRead_organizationId_idx"
  ON "OrganizationAnnouncementRead"("organizationId");

ALTER TABLE "OrganizationAnnouncementRead"
  ADD CONSTRAINT "OrganizationAnnouncementRead_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "OrganizationAnnouncement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationAnnouncementRead"
  ADD CONSTRAINT "OrganizationAnnouncementRead_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
