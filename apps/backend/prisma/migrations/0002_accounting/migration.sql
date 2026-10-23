-- CreateEnum
CREATE TYPE "CalcKind" AS ENUM ('LEDGER_RECOMPUTE', 'RENORMALIZE', 'ALGO_UPGRADE', 'CALC_PARAMS_CHANGE', 'BILLING');

-- CreateEnum
CREATE TYPE "MeterReadingSource" AS ENUM ('UTILITY_METER_MANUAL', 'HOYMILES_METER_LCD');

-- CreateTable
CREATE TABLE "EnergyInterval" (
    "bucketStart" TIMESTAMPTZ(0) NOT NULL,
    "calcVersion" INTEGER NOT NULL,
    "maxGapSecUsed" INTEGER NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "computedAt" TIMESTAMPTZ(3) NOT NULL,
    "gridImportNetWh" DECIMAL(12,3),
    "gridExportNetWh" DECIMAL(12,3),
    "gridImportPhaseWh" DECIMAL(12,3),
    "gridExportPhaseWh" DECIMAL(12,3),
    "gridImportCounterWh" DECIMAL(12,3),
    "gridExportCounterWh" DECIMAL(12,3),
    "pvIntWh" DECIMAL(12,3),
    "pvCounterWh" DECIMAL(12,3),
    "batChargeIntWh" DECIMAL(12,3),
    "batDischargeIntWh" DECIMAL(12,3),
    "batChargeCounterWh" DECIMAL(12,3),
    "batDischargeCounterWh" DECIMAL(12,3),
    "loadDerivedWh" DECIMAL(12,3),
    "loadCounterWh" DECIMAL(12,3),
    "gridCoveredSec" INTEGER NOT NULL,
    "pvCoveredSec" INTEGER NOT NULL,
    "batCoveredSec" INTEGER NOT NULL,
    "loadCoveredSec" INTEGER NOT NULL,
    "counterUnknownSec" INTEGER[],
    "counterGapAllocMask" INTEGER NOT NULL,
    "flags" INTEGER NOT NULL,
    "counterState" JSONB,
    "gridAvgW" INTEGER,
    "gridMinW" INTEGER,
    "gridMaxW" INTEGER,
    "pvAvgW" INTEGER,
    "pvMaxW" INTEGER,
    "batAvgW" INTEGER,
    "loadAvgW" INTEGER,
    "loadMaxW" INTEGER,
    "socMin" INTEGER,
    "socMax" INTEGER,
    "socLast" INTEGER,

    CONSTRAINT "EnergyInterval_pkey" PRIMARY KEY ("bucketStart")
);

-- CreateTable
CREATE TABLE "AccountingPolicy" (
    "version" SERIAL NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "supersededByVersion" INTEGER,
    "gridSource" TEXT NOT NULL,
    "pvSource" TEXT NOT NULL,
    "batterySource" TEXT NOT NULL,
    "loadSource" TEXT NOT NULL,
    "maxGapSec" INTEGER NOT NULL,
    "validated" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPolicy_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "DataExclusion" (
    "id" SERIAL NOT NULL,
    "from" TIMESTAMPTZ(3) NOT NULL,
    "to" TIMESTAMPTZ(3) NOT NULL,
    "families" TEXT[],
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataExclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationRun" (
    "id" SERIAL NOT NULL,
    "kind" "CalcKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "rangeStart" TIMESTAMPTZ(3) NOT NULL,
    "rangeEnd" TIMESTAMPTZ(3) NOT NULL,
    "calcVersion" INTEGER NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "error" TEXT,

    CONSTRAINT "CalculationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" SERIAL NOT NULL,
    "readAt" TIMESTAMPTZ(3) NOT NULL,
    "importKwh" DECIMAL(12,3) NOT NULL,
    "exportKwh" DECIMAL(12,3),
    "importPeakKwh" DECIMAL(12,3),
    "importOffpeakKwh" DECIMAL(12,3),
    "resolutionKwh" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "source" "MeterReadingSource" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExclusion_from_to_idx" ON "DataExclusion"("from", "to");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_readAt_source_key" ON "MeterReading"("readAt", "source");

