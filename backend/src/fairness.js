/**
 * Fairness core. All randomness and verification live in this one file
 * so anyone can audit the exact algorithm.
 *
 * ── Provably-fair draw (commit–reveal + hash chain) ──────────────────────
 *
 * Before the draw button is pressed:
 *   C1. server_seed      = 32 random bytes (CSPRNG), kept secret
 *   C2. server_seed_hash = SHA-256(server_seed)          ← shown on screen ("commitment")
 *
 * When the button is pressed the browser sends
 *   client_seed = "#<16 random bytes from the browser>"
 * The server cannot know client_seed when it made the commitment, and the
 * browser cannot know server_seed, so NEITHER side can steer the result.
 *
 * Public beacon (see beacon.js): the server also takes the FIRST drand round
 * published AFTER the request arrived. Its randomness is unknowable to anyone
 * in the room at the moment the button is pressed — including someone who
 * controls both the server and the browser — and anyone can fetch it later.
 *
 * For every pick i (0-based) inside the batch:
 *   1. pool_snapshot  = participants with is_winner = FALSE, sorted by id
 *   2. snapshot_hash  = SHA-256( JSON.stringify(pool_snapshot) )
 *   3. prev_hash      = verification_hash of the previous draw_order
 *                       (GENESIS = 64 zeros when there is no previous draw)
 *   4. draw_seed      = SHA-256( server_seed | client_seed | prev_hash | i [ | beacon_round:beacon_randomness ] )
 *   5. random_index   = BigInt( SHA-256(draw_seed) ) mod pool_size
 *   6. winner         = pool_snapshot[random_index]
 *   7. verification_hash = SHA-256( snapshot_hash | draw_seed | random_index | winner.id )
 *
 * Every value in 2–7 is recomputable from the stored record, and step 3 links
 * each draw to the one before it: deleting or re-rolling a past draw breaks the
 * chain for every draw after it.
 *
 * Records created before this scheme (server_seed IS NULL) used a raw random
 * draw_seed and are verified with steps 1, 2, 5–7 only.
 */
const crypto = require('crypto');

const GENESIS_HASH = '0'.repeat(64);

function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

function serializeSnapshot(rows) {
  const snapshot = rows
    .map((r) => ({ id: r.id, full_name: r.full_name, entry_code: r.entry_code }))
    .sort((a, b) => a.id - b.id);
  return JSON.stringify(snapshot);
}

/** 32 CSPRNG bytes as hex — used for server seeds (and legacy draw seeds). */
function generateSeed() {
  return crypto.randomBytes(32).toString('hex');
}

function commitmentHash(serverSeed) {
  return sha256(serverSeed);
}

/** Step 4: the per-pick seed nobody could have chosen alone. */
function deriveDrawSeed({ serverSeed, clientSeed, prevHash, pickIndex, beacon }) {
  const base = `${serverSeed}|${clientSeed ?? ''}|${prevHash}|${pickIndex}`;
  return sha256(beacon ? `${base}|${beacon.round}:${beacon.randomness}` : base);
}

function indexFromSeed(seed, poolSize) {
  if (!Number.isInteger(poolSize) || poolSize <= 0) throw new Error('Invalid pool size');
  const n = BigInt('0x' + sha256(seed));
  return Number(n % BigInt(poolSize));
}

function verificationHash({ snapshotHash, seed, randomIndex, participantId }) {
  return sha256(`${snapshotHash}|${seed}|${randomIndex}|${participantId}`);
}

/**
 * Recompute the whole draw from a logged record.
 * Pass `expectedPrevHash` (verification_hash of the previous draw, or
 * GENESIS_HASH) to also check the chain link.
 */
function verifyDrawRecord(record, expectedPrevHash) {
  try {
    return verifyDrawRecordStrict(record, expectedPrevHash);
  } catch (e) {
    // A malformed record must read as INVALID, never crash the audit/archive listing
    return { valid: false, error: e.message, checks: {}, recomputed: null, scheme: 'unknown' };
  }
}

function verifyDrawRecordStrict(record, expectedPrevHash) {
  const snapshot = typeof record.pool_snapshot === 'string'
    ? JSON.parse(record.pool_snapshot)
    : record.pool_snapshot;
  const snapshotJson = serializeSnapshot(snapshot);
  const snapshotHash = sha256(snapshotJson);
  const poolSize = snapshot.length;
  const committed = record.server_seed != null && record.server_seed !== '';

  const checks = {};
  let seed = record.draw_seed;
  if (committed) {
    const derived = deriveDrawSeed({
      serverSeed: record.server_seed,
      clientSeed: record.client_seed ?? '',
      prevHash: record.prev_hash,
      pickIndex: Number(record.pick_index),
      beacon: record.beacon_round != null ? { round: Number(record.beacon_round), randomness: record.beacon_randomness } : null,
    });
    checks.commitment_matches = commitmentHash(record.server_seed) === record.server_seed_hash;
    checks.seed_derivation_matches = derived === record.draw_seed;
    seed = derived; // verify the rest against what the seed SHOULD be
  }

  const expectedIndex = indexFromSeed(seed, poolSize);
  const expectedWinner = snapshot[expectedIndex];
  const expectedVerification = verificationHash({
    snapshotHash,
    seed,
    randomIndex: expectedIndex,
    participantId: expectedWinner ? expectedWinner.id : null,
  });

  checks.snapshot_hash_matches = snapshotHash === record.snapshot_hash;
  checks.pool_size_matches = poolSize === Number(record.pool_size);
  checks.random_index_matches = expectedIndex === Number(record.random_index);
  checks.winner_matches = !!expectedWinner && expectedWinner.id === Number(record.participant_id);
  checks.verification_hash_matches = expectedVerification === record.verification_hash;
  if (committed && expectedPrevHash !== undefined) {
    checks.chain_link_matches = record.prev_hash === expectedPrevHash;
  }

  return {
    valid: Object.values(checks).every(Boolean),
    scheme: !committed ? 'legacy' : record.beacon_round != null ? 'commit-reveal+beacon' : 'commit-reveal',
    beacon: record.beacon_round != null ? { chain: record.beacon_chain, round: Number(record.beacon_round), randomness: record.beacon_randomness } : null,
    checks,
    recomputed: {
      snapshot_hash: snapshotHash,
      pool_size: poolSize,
      draw_seed: seed,
      random_index: expectedIndex,
      winner: expectedWinner || null,
      verification_hash: expectedVerification,
      ...(committed ? { server_seed_hash: commitmentHash(record.server_seed) } : {}),
    },
  };
}

/**
 * Verify an ordered list of records (by draw_order) including the chain:
 * every committed record's prev_hash must equal the previous record's
 * verification_hash (or GENESIS when it is the first).
 */
function verifyChain(records) {
  let prev = GENESIS_HASH;
  const results = records.map((r) => {
    const v = verifyDrawRecord(r, prev);
    prev = r.verification_hash;
    return v;
  });
  return { results, chain_valid: results.every((v) => v.valid), head: prev };
}

module.exports = {
  GENESIS_HASH,
  sha256,
  serializeSnapshot,
  generateSeed,
  commitmentHash,
  deriveDrawSeed,
  indexFromSeed,
  verificationHash,
  verifyDrawRecord,
  verifyChain,
};
