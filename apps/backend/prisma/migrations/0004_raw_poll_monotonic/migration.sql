-- AlterTable
-- Acquisition-time monotonic clock of FAST polls, plus the clock-validity bit and repeat age
-- needed when Sample retention and raw retention remove a poll's acquisition predecessor.
-- NULL for rows captured before this migration: timing is never inferred from wall time.
ALTER TABLE "RawPoll"
  ADD COLUMN "monotonicMs" DOUBLE PRECISION,
  ADD COLUMN "acquisitionClockStep" BOOLEAN,
  ADD COLUMN "acquisitionMeterRepeatSec" INTEGER;

-- CreateIndex
-- Replay walks each device's polls in acquisition order (collector run, then sequence).
CREATE INDEX "RawPoll_deviceId_runId_seq_idx" ON "RawPoll"("deviceId", "runId", "seq");
