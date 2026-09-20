-- Migration 003 — public randomness beacon (drand) mixed into every draw seed.
-- NULL on draws made before this migration or while the beacon was unreachable.
ALTER TABLE winners
  ADD COLUMN beacon_chain      CHAR(64) NULL AFTER committed_at,
  ADD COLUMN beacon_round      BIGINT   NULL AFTER beacon_chain,
  ADD COLUMN beacon_randomness CHAR(64) NULL AFTER beacon_round;

ALTER TABLE winners_archive
  ADD COLUMN beacon_chain      CHAR(64) NULL AFTER committed_at,
  ADD COLUMN beacon_round      BIGINT   NULL AFTER beacon_chain,
  ADD COLUMN beacon_randomness CHAR(64) NULL AFTER beacon_round;
