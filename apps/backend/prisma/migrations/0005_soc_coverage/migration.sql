-- SOC (block 1800) is independent of the selected battery-power register block.
-- No backfill from batCoveredSec or extrema: neither proves SOC observation coverage.
-- Ledger algorithm 3 recomputes where retained Sample evidence supports it; historical
-- rows without that evidence keep NULL coverage and their original energy/statistics.
ALTER TABLE "EnergyInterval" ADD COLUMN "socCoveredSec" INTEGER;
