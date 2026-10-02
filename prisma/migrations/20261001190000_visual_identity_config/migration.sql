-- Visual identity configuration (draft fields on WebsiteContent).
-- Backward compatible: both nullable; null = never configured, public
-- site falls back to the default preset mapping.

-- AlterTable
ALTER TABLE "WebsiteContent" ADD COLUMN     "visualPreset" TEXT;
ALTER TABLE "WebsiteContent" ADD COLUMN     "visualConfig" JSONB;
