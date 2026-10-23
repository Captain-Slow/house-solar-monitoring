-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DeviceRole" AS ENUM ('INVERTER');

-- CreateEnum
CREATE TYPE "PollTier" AS ENUM ('DETECT', 'FAST', 'SLOW', 'SETTINGS');

-- CreateEnum
CREATE TYPE "QualityEventKind" AS ENUM ('GAP', 'DB_UNAVAILABLE', 'CONNECTION_LOST', 'METER_LINK_DOWN', 'METER_STALE', 'BLOCK_INVALID', 'COUNTER_RESET', 'COUNTER_JUMP_REJECTED', 'COUNTER_DISCONTINUITY', 'CLOCK_STEP', 'DEVICE_REPLACED', 'CAPABILITY_CHANGED', 'IDENTITY_MISMATCH', 'NEGATIVE_DERIVED_LOAD', 'BALANCE_ANOMALY', 'FAULT_ACTIVE', 'ACQUISITION_SOURCE_CHANGED', 'CLOUD_AUTH_FAILED');

-- CreateEnum
CREATE TYPE "DirtyReason" AS ENUM ('INGEST', 'EXCLUSION', 'RENORMALIZE', 'RECALC_REQUEST', 'CALC_PARAMS', 'ALGO_UPGRADE');

-- CreateEnum
CREATE TYPE "TokenRole" AS ENUM ('VIEWER', 'ADMIN');

-- CreateTable
CREATE TABLE "DataSource" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" SERIAL NOT NULL,
    "dataSourceId" INTEGER NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "role" "DeviceRole" NOT NULL,
    "model" TEXT NOT NULL,
    "observedCapabilities" JSONB NOT NULL,
    "capabilitiesObservedAt" TIMESTAMPTZ(3) NOT NULL,
    "firmware" JSONB NOT NULL,
    "latestStatus" JSONB,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "replacementReason" TEXT,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" SERIAL NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "appVersion" TEXT NOT NULL,
    "registerMapVersion" TEXT NOT NULL,
    "endReason" TEXT,

    CONSTRAINT "CollectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingVersion" (
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "RawPoll" (
    "id" BIGSERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "tier" "PollTier" NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "blocks" BYTEA NOT NULL,
    "contentHash" BYTEA NOT NULL,

    CONSTRAINT "RawPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" BIGSERIAL NOT NULL,
    "rawPollId" BIGINT NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "mappingVersion" INTEGER NOT NULL,
    "meterLink" INTEGER,
    "gridW" INTEGER,
    "gridAW" INTEGER,
    "gridBW" INTEGER,
    "gridCW" INTEGER,
    "gridVoltA" DECIMAL(5,1),
    "gridVoltB" DECIMAL(5,1),
    "gridVoltC" DECIMAL(5,1),
    "gridPortW" INTEGER,
    "inverterAcW" INTEGER,
    "epsW" INTEGER,
    "pvW" INTEGER,
    "pvStringW" INTEGER[],
    "batteryW" INTEGER,
    "batteryBmsW" INTEGER,
    "batterySoc" INTEGER,
    "batteryState" INTEGER,
    "loadVendorW" INTEGER,
    "loadVendorTotalW" INTEGER,
    "pvWh" BIGINT,
    "gridBuyWh" BIGINT,
    "gridSellWh" BIGINT,
    "gridBuyPhaseWh" BIGINT[],
    "gridSellPhaseWh" BIGINT[],
    "batChargeWh" BIGINT,
    "batDischargeWh" BIGINT,
    "loadUseWh" BIGINT,
    "vendorToday" JSONB,
    "meterRepeatSec" INTEGER NOT NULL,
    "flags" INTEGER NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityEvent" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" INTEGER,
    "kind" "QualityEventKind" NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerDirtyRange" (
    "id" BIGSERIAL NOT NULL,
    "fromBucket" TIMESTAMPTZ(0) NOT NULL,
    "toBucket" TIMESTAMPTZ(0) NOT NULL,
    "reason" "DirtyReason" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerDirtyRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role" "TokenRole" NOT NULL,
    "tokenHash" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_kind_endpoint_key" ON "DataSource"("kind", "endpoint");

-- CreateIndex
CREATE INDEX "Device_dataSourceId_retiredAt_idx" ON "Device"("dataSourceId", "retiredAt");

-- CreateIndex
CREATE INDEX "RawPoll_deviceId_observedAt_idx" ON "RawPoll"("deviceId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawPoll_runId_seq_key" ON "RawPoll"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_rawPollId_key" ON "Sample"("rawPollId");

-- CreateIndex
CREATE INDEX "Sample_observedAt_idx" ON "Sample"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_deviceId_observedAt_key" ON "Sample"("deviceId", "observedAt");

-- CreateIndex
CREATE INDEX "DataQualityEvent_kind_startedAt_idx" ON "DataQualityEvent"("kind", "startedAt");

-- CreateIndex
CREATE INDEX "LedgerDirtyRange_fromBucket_idx" ON "LedgerDirtyRange"("fromBucket");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_name_key" ON "ApiToken"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPoll" ADD CONSTRAINT "RawPoll_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CollectorRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPoll" ADD CONSTRAINT "RawPoll_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_rawPollId_fkey" FOREIGN KEY ("rawPollId") REFERENCES "RawPoll"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_mappingVersion_fkey" FOREIGN KEY ("mappingVersion") REFERENCES "MappingVersion"("version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityEvent" ADD CONSTRAINT "DataQualityEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Exactly one non-retired Device per (dataSourceId, deviceKey): replacement is an explicit workflow.
CREATE UNIQUE INDEX "Device_dataSourceId_deviceKey_active_key" ON "Device"("dataSourceId", "deviceKey") WHERE "retiredAt" IS NULL;
