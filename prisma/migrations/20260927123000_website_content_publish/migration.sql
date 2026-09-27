-- Website content draft/publish snapshot + audit action
ALTER TABLE "WebsiteContent" ADD COLUMN "publishedContent" JSONB;
ALTER TABLE "WebsiteContent" ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TYPE "AuditAction" ADD VALUE 'WEBSITE_CONTENT_PUBLISHED';
