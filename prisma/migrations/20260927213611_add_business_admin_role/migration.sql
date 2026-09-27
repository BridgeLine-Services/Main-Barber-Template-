/* Adds the BUSINESS_ADMIN staff role (Requirement 7): manages the
   business operationally, but never platform or ownership functions. */

ALTER TYPE "UserRole" ADD VALUE 'BUSINESS_ADMIN';
