ALTER TABLE "Business" ADD COLUMN "privacyPolicyStatus" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Business" ADD COLUMN "termsPolicyStatus" TEXT NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Business" ADD COLUMN "privacyPolicyVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Business" ADD COLUMN "termsPolicyVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Business" ADD COLUMN "privacyPolicyPublishedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "termsPolicyPublishedAt" TIMESTAMP(3);
ALTER TABLE "Business" ADD COLUMN "privacyPolicyPublishedById" TEXT;
ALTER TABLE "Business" ADD COLUMN "termsPolicyPublishedById" TEXT;
