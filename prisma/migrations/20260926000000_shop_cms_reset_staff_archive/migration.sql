-- Shop CMS: staff deactivation, inventory archive, shop reset audit action

-- Staff soft-deactivation: blocks sign-in without destroying the account
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Inventory soft-archive
ALTER TABLE "InventoryItem" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Audit action for the shop configuration reset
ALTER TYPE "AuditAction" ADD VALUE 'SHOP_CONFIGURATION_RESET';
