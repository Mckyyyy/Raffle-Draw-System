-- LGU Raffle Draw System — MySQL schema (WAMPServer)
-- Run: mysql -u root -p < database/schema.sql   (or import via phpMyAdmin)

CREATE DATABASE IF NOT EXISTS lgu_raffle
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE lgu_raffle;

CREATE TABLE IF NOT EXISTS participants (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  full_name   VARCHAR(150) NOT NULL,
  entry_code  VARCHAR(64)  NOT NULL UNIQUE,
  is_winner   BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_is_winner (is_winner)
) ENGINE=InnoDB;

-- winners = draw log. Every row is one draw with its complete audit trail.
CREATE TABLE IF NOT EXISTS winners (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  participant_id    INT NOT NULL UNIQUE,
  draw_order        INT NOT NULL UNIQUE,
  drawn_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  draw_seed         VARCHAR(64)  NOT NULL,   -- final per-pick seed (see backend/src/fairness.js)
  server_seed       CHAR(64)     NULL,       -- revealed after the draw; its hash was published beforehand
  server_seed_hash  CHAR(64)     NULL,       -- the commitment shown on screen before the button was pressed
  client_seed       VARCHAR(255) NULL,       -- browser nonce chosen after the commitment
  prev_hash         CHAR(64)     NULL,       -- verification_hash of the previous draw (hash chain)
  pick_index        INT          NULL,       -- position inside a multi-winner batch (0-based)
  committed_at      TIMESTAMP(3) NULL,       -- when the server commitment was created
  beacon_chain      CHAR(64)     NULL,       -- drand chain hash (public randomness beacon)
  beacon_round      BIGINT       NULL,       -- first drand round published AFTER the draw request
  beacon_randomness CHAR(64)     NULL,       -- that round's randomness, mixed into draw_seed
  random_index      INT NOT NULL,            -- SHA-256(draw_seed) mod pool_size
  pool_size         INT NOT NULL,
  pool_snapshot     JSON NOT NULL,           -- [{id, full_name, entry_code}] sorted by id, taken before the draw
  snapshot_hash     CHAR(64) NOT NULL,       -- SHA-256 of the pool_snapshot JSON
  verification_hash CHAR(64) NOT NULL,       -- SHA-256(snapshot_hash + draw_seed + random_index + participant_id)
  CONSTRAINT fk_winner_participant
    FOREIGN KEY (participant_id) REFERENCES participants(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Sample data (safe to delete)
INSERT IGNORE INTO participants (full_name, entry_code) VALUES
  ('Juan Dela Cruz',    'STUB-0001'),
  ('Maria Santos',      'STUB-0002'),
  ('Pedro Reyes',       'STUB-0003'),
  ('Ana Garcia',        'STUB-0004'),
  ('Jose Ramos',        'STUB-0005'),
  ('Liza Mendoza',      'STUB-0006'),
  ('Carlo Bautista',    'STUB-0007'),
  ('Rowena Villanueva', 'STUB-0008'),
  ('Mark Aquino',       'STUB-0009'),
  ('Grace Torres',      'STUB-0010');

-- ---------------------------------------------------------------------------
-- Archive. A "Reset" (Admin) moves the whole winners table into these tables
-- as one session, then clears winners and sets every is_winner back to FALSE.
-- Nothing is permanently deleted; every archived draw stays verifiable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS draw_sessions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  archived_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  first_draw_at      TIMESTAMP(3) NULL,
  last_draw_at       TIMESTAMP(3) NULL,
  total_draws        INT NOT NULL,
  total_participants INT NOT NULL,
  note               VARCHAR(255) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS winners_archive (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  session_id        INT NOT NULL,
  original_draw_id  INT NOT NULL,
  participant_id    INT NOT NULL,
  full_name         VARCHAR(150) NOT NULL,   -- denormalized so the record survives participant edits
  entry_code        VARCHAR(64)  NOT NULL,
  draw_order        INT NOT NULL,
  drawn_at          TIMESTAMP(3) NOT NULL,
  draw_seed         VARCHAR(64)  NOT NULL,
  server_seed       CHAR(64)     NULL,
  server_seed_hash  CHAR(64)     NULL,
  client_seed       VARCHAR(255) NULL,
  prev_hash         CHAR(64)     NULL,
  pick_index        INT          NULL,
  committed_at      TIMESTAMP(3) NULL,
  beacon_chain      CHAR(64)     NULL,
  beacon_round      BIGINT       NULL,
  beacon_randomness CHAR(64)     NULL,
  random_index      INT NOT NULL,
  pool_size         INT NOT NULL,
  pool_snapshot     JSON NOT NULL,
  snapshot_hash     CHAR(64) NOT NULL,
  verification_hash CHAR(64) NOT NULL,
  INDEX idx_session (session_id, draw_order),
  CONSTRAINT fk_archive_session
    FOREIGN KEY (session_id) REFERENCES draw_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Admin account. One row. Seeded from ADMIN_PASSWORD in .env the first time
-- the server needs it; afterwards the password is changed from the Admin page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_account (
  id                  TINYINT PRIMARY KEY DEFAULT 1,
  display_name        VARCHAR(100) NOT NULL DEFAULT 'Administrator',
  password_hash       VARCHAR(100) NOT NULL,
  password_changed_at TIMESTAMP NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT single_admin CHECK (id = 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Server commitments (provably-fair draws). The server_seed is generated and
-- ONLY its hash is shown on the Live Draw screen before the draw. The seed is
-- revealed in the draw record afterwards, so the server cannot search for a
-- seed that produces a chosen winner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS draw_commitments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  server_seed      CHAR(64) NOT NULL,
  server_seed_hash CHAR(64) NOT NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  used_at          TIMESTAMP(3) NULL
) ENGINE=InnoDB;
