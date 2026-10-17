-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "providerCustomerRef" TEXT;

-- AlterTable
ALTER TABLE "MembershipPlan" ADD COLUMN     "providerPriceRef" TEXT;
