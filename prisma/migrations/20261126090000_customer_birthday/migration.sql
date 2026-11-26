-- Birthday month and day only: a full date of birth is more personal information than a
-- birthday greeting needs. Both columns are nullable, so existing customers are untouched.
ALTER TABLE "Customer" ADD COLUMN "birthdayMonth" INTEGER,
ADD COLUMN "birthdayDay" INTEGER;

CREATE INDEX "Customer_businessId_birthdayMonth_idx" ON "Customer"("businessId", "birthdayMonth");
