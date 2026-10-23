-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('COMPLETE', 'ESTIMATED', 'UNAVAILABLE');

-- CreateTable
CREATE TABLE "Tariff" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffVersion" (
    "id" SERIAL NOT NULL,
    "tariffId" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "rulesSchemaVersion" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "sourceNote" TEXT NOT NULL,
    "billVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TariffVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffHoliday" (
    "tariffId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "TariffHoliday_pkey" PRIMARY KEY ("tariffId","date")
);

-- CreateTable
CREATE TABLE "TariffMonthlyRate" (
    "tariffId" INTEGER NOT NULL,
    "componentCode" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "ratePerKwh" DECIMAL(12,6) NOT NULL,
    "sourceNote" TEXT NOT NULL,

    CONSTRAINT "TariffMonthlyRate_pkey" PRIMARY KEY ("tariffId","componentCode","month")
);

-- CreateTable
CREATE TABLE "BillingPeriod" (
    "id" SERIAL NOT NULL,
    "tariffId" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "openingCreditLots" JSONB,
    "bill" JSONB,
    "note" TEXT,

    CONSTRAINT "BillingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPeriodResult" (
    "billingPeriodId" INTEGER NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,
    "calcVersion" INTEGER NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "policyVersions" INTEGER[],
    "tariffVersionIds" INTEGER[],
    "quantities" JSONB NOT NULL,
    "lineItems" JSONB NOT NULL,
    "nem" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2),
    "total" DECIMAL(12,2),
    "status" "BillingStatus" NOT NULL,
    "reasons" TEXT[],
    "isLowerBound" BOOLEAN NOT NULL,
    "coverage" DECIMAL(5,4) NOT NULL,

    CONSTRAINT "BillingPeriodResult_pkey" PRIMARY KEY ("billingPeriodId")
);

-- CreateIndex
CREATE INDEX "TariffVersion_tariffId_effectiveFrom_idx" ON "TariffVersion"("tariffId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPeriod_tariffId_startDate_key" ON "BillingPeriod"("tariffId", "startDate");

-- AddForeignKey
ALTER TABLE "TariffVersion" ADD CONSTRAINT "TariffVersion_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffHoliday" ADD CONSTRAINT "TariffHoliday_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffMonthlyRate" ADD CONSTRAINT "TariffMonthlyRate_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPeriod" ADD CONSTRAINT "BillingPeriod_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPeriodResult" ADD CONSTRAINT "BillingPeriodResult_billingPeriodId_fkey" FOREIGN KEY ("billingPeriodId") REFERENCES "BillingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

