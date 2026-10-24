-- METER_PER_PHASE has its own coverage: the seconds in which all three normalized phases were valid.
-- No backfill from gridCoveredSec: that column is the meter-total (register 1814) coverage and proves
-- nothing about the phases. Historical rows keep NULL = unknown phase coverage; readers then fall back to
-- gridCoveredSec (the behaviour those rows were stored and reported under) until ordinary ledger recompute
-- of retained Sample evidence writes the real value. Ledger algorithm version 3 and all stored energy are
-- unchanged.
ALTER TABLE "EnergyInterval" ADD COLUMN "gridPhaseCoveredSec" INTEGER;
