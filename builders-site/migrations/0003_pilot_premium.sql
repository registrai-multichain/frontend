-- ABI points pilot: the milestone premium (spec §9.15, audit PE-2; owner decision 2026-10-11: longs pay it).
-- rates.premium: the premium per unit of long notional per hour that the hour's long rate includes (the house
-- collects it, so house_funding includes premium · L). From live/mark.py's `milestone_premium`; 0 when the
-- producer does not send the key. NULL only on rows fixed before this migration.
ALTER TABLE rates ADD COLUMN premium REAL;
