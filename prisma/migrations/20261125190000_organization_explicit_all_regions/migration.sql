-- All-region access becomes explicit.
--
-- OrganizationMember.regions used to mean "every region" when empty, so a member
-- whose regions were never filled in silently held access to every location in
-- the organization. This migration makes that grant explicit and, crucially,
-- preserves the access those members already have: every existing row with an
-- empty regions array is marked allRegions = true. Nobody gains or loses scope
-- as a result of this migration; only new members must choose.
ALTER TABLE "OrganizationMember" ADD COLUMN "allRegions" BOOLEAN NOT NULL DEFAULT false;

UPDATE "OrganizationMember"
SET "allRegions" = true
WHERE cardinality("regions") = 0;

ALTER TABLE "OrganizationInvitation" ADD COLUMN "allRegions" BOOLEAN NOT NULL DEFAULT false;

-- An invitation already sent with an empty region list was, under the old
-- meaning, an all-region grant. Preserve what the inviter intended.
UPDATE "OrganizationInvitation"
SET "allRegions" = true
WHERE cardinality("regions") = 0 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL;
