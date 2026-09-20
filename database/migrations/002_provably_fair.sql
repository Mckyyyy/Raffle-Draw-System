-- Migration 002 — provably-fair draws (commit–reveal + hash chain)
-- Safe to run on an existing lgu_raffle database. schema.sql already contains
-- these columns/tables for fresh installs.
USE lgu_raffle;

-- Server commitments: the server_seed is generated and its hash published
-- BEFORE the draw button is pressed, so the server cannot search for a seed
-- that produces a chosen winner.
CREATE TABLE IF NOT EXISTS draw_commitments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  server_seed      CHAR(64) NOT NULL,
  server_seed_hash CHAR(64) NOT NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  used_at          TIMESTAMP(3) NULL
) ENGINE=InnoDB;

-- Extra audit fields on every draw. NULL on rows made before this migration
-- (those verify with the original single-seed scheme).
ALTER TABLE winners
  ADD COLUMN IF NOT EXISTS server_seed      CHAR(64)     NULL AFTER draw_seed,
  ADD COLUMN IF NOT EXISTS server_seed_hash CHAR(64)     NULL AFTER server_seed,
  ADD COLUMN IF NOT EXISTS client_seed      VARCHAR(255) NULL AFTER server_seed_hash,
  ADD COLUMN IF NOT EXISTS prev_hash        CHAR(64)     NULL AFTER client_seed,
  ADD COLUMN IF NOT EXISTS pick_index       INT          NULL AFTER prev_hash,
  ADD COLUMN IF NOT EXISTS committed_at     TIMESTAMP(3) NULL AFTER pick_index;

ALTER TABLE winners_archive
  ADD COLUMN IF NOT EXISTS server_seed      CHAR(64)     NULL AFTER draw_seed,
  ADD COLUMN IF NOT EXISTS server_seed_hash CHAR(64)     NULL AFTER server_seed,
  ADD COLUMN IF NOT EXISTS client_seed      VARCHAR(255) NULL AFTER server_seed_hash,
  ADD COLUMN IF NOT EXISTS prev_hash        CHAR(64)     NULL AFTER client_seed,
  ADD COLUMN IF NOT EXISTS pick_index       INT          NULL AFTER prev_hash,
  ADD COLUMN IF NOT EXISTS committed_at     TIMESTAMP(3) NULL AFTER pick_index;
