-- Sync template schema drift (found during the 2026-10-17 migration-conflict repair):
-- `prisma migrate diff` reported that schema.prisma declares the CLAIMED
-- WaitlistStatus variant (added to the schema in c5cbac7) but no migration ever
-- delivered it to databases. No application code references CLAIMED yet, so
-- this is purely additive: it aligns existing databases with the declared
-- Prisma schema without touching any data.
ALTER TYPE "WaitlistStatus" ADD VALUE IF NOT EXISTS 'CLAIMED';
