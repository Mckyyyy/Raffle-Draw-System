const express = require('express');
const pool = require('../db');
const F = require('../fairness');
const beaconApi = require('../beacon');

const router = express.Router();

const ALGORITHM_TEXT = [
  'BEFORE the button is pressed: server_seed = 32 CSPRNG bytes (kept secret); server_seed_hash = SHA-256(server_seed) is shown on screen — the commitment',
  'WHEN the button is pressed: the browser sends client_seed = "#<16 random browser bytes>", unknown to the server at commitment time',
  'pool_snapshot = all participants with is_winner = FALSE, sorted by id (taken right before each pick)',
  'snapshot_hash = SHA-256(JSON.stringify(pool_snapshot))',
  'prev_hash = verification_hash of the previous draw (64 zeros for the first) — the hash chain',
  'beacon = the first drand round published AFTER the request arrived (public randomness nobody in the room can know in advance); null if offline',
  'draw_seed = SHA-256(server_seed + "|" + client_seed + "|" + prev_hash + "|" + pick_index [+ "|" + beacon_round + ":" + beacon_randomness])',
  'random_index = BigInt(SHA-256(draw_seed)) mod pool_size',
  'winner = pool_snapshot[random_index]',
  'verification_hash = SHA-256(snapshot_hash + "|" + draw_seed + "|" + random_index + "|" + winner.id)',
  'Draws recorded before this scheme (no server_seed) used a raw random draw_seed and skip the commitment/chain checks.',
];

// Public: all winners, ordered by draw_order
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.id AS draw_id, w.draw_order, w.drawn_at, w.pool_size, w.random_index,
              w.draw_seed, w.snapshot_hash, w.verification_hash,
              p.id AS participant_id, p.full_name, p.entry_code
       FROM winners w JOIN participants p ON p.id = w.participant_id
       ORDER BY w.draw_order`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Public: full draw log (every draw with timestamp, seed, and pool snapshot) + server-side verification
router.get('/audit', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.*, p.full_name, p.entry_code
       FROM winners w JOIN participants p ON p.id = w.participant_id
       ORDER BY w.draw_order`
    );
    const chain = F.verifyChain(rows);
    const results = rows.map((r, i) => ({
      draw_id: r.id,
      draw_order: r.draw_order,
      drawn_at: r.drawn_at,
      participant_id: r.participant_id,
      full_name: r.full_name,
      entry_code: r.entry_code,
      pool_size: r.pool_size,
      random_index: r.random_index,
      draw_seed: r.draw_seed,
      server_seed_hash: r.server_seed_hash,
      client_seed: r.client_seed,
      prev_hash: r.prev_hash,
      committed_at: r.committed_at,
      beacon_round: r.beacon_round,
      beacon_randomness: r.beacon_randomness,
      snapshot_hash: r.snapshot_hash,
      verification_hash: r.verification_hash,
      pool_snapshot: typeof r.pool_snapshot === 'string' ? JSON.parse(r.pool_snapshot) : r.pool_snapshot,
      scheme: chain.results[i].scheme,
      valid: chain.results[i].valid,
      checks: chain.results[i].checks,
    }));
    res.json({ all_valid: chain.chain_valid, chain_head: chain.head, results, algorithm: ALGORITHM_TEXT });
  } catch (e) { next(e); }
});

// Public: complete audit record for one draw + server-side re-verification
router.get('/audit/:drawId', async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      `SELECT w.*, p.full_name, p.entry_code
       FROM winners w JOIN participants p ON p.id = w.participant_id
       WHERE w.id = ?`, [req.params.drawId]
    );
    if (!row) return res.status(404).json({ error: 'Draw not found.' });
    const [[prev]] = await pool.query(
      'SELECT verification_hash FROM winners WHERE draw_order < ? ORDER BY draw_order DESC LIMIT 1', [row.draw_order]
    );
    const expectedPrev = prev ? prev.verification_hash : F.GENESIS_HASH;
    const verification = F.verifyDrawRecord(row, expectedPrev);
    const beacon_check = await beaconApi.verifyBeacon(row);   // re-fetches the round from drand
    res.json({ record: row, verification, beacon_check, expected_prev_hash: expectedPrev, algorithm: ALGORITHM_TEXT });
  } catch (e) { next(e); }
});


// Public: archived sessions (from Admin "Reset"), each with its full draw log + verification
router.get('/archive', async (req, res, next) => {
  try {
    const [sessions] = await pool.query('SELECT * FROM draw_sessions ORDER BY id DESC');
    const [rows] = await pool.query('SELECT * FROM winners_archive ORDER BY session_id DESC, draw_order ASC');
    const bySession = {};
    const rowsBySession = {};
    for (const r of rows) (rowsBySession[r.session_id] ||= []).push(r);
    const chainBySession = Object.fromEntries(Object.entries(rowsBySession).map(([id, rs]) => [id, F.verifyChain(rs)]));
    for (const r of rows) {
      const idx = rowsBySession[r.session_id].indexOf(r);
      (bySession[r.session_id] ||= []).push({
        archive_id: r.id,
        original_draw_id: r.original_draw_id,
        draw_order: r.draw_order,
        drawn_at: r.drawn_at,
        participant_id: r.participant_id,
        full_name: r.full_name,
        entry_code: r.entry_code,
        pool_size: r.pool_size,
        random_index: r.random_index,
        draw_seed: r.draw_seed,
        snapshot_hash: r.snapshot_hash,
        verification_hash: r.verification_hash,
        server_seed_hash: r.server_seed_hash,
        client_seed: r.client_seed,
        prev_hash: r.prev_hash,
        beacon_round: r.beacon_round,
        pool_snapshot: typeof r.pool_snapshot === 'string' ? JSON.parse(r.pool_snapshot) : r.pool_snapshot,
        scheme: chainBySession[r.session_id].results[idx].scheme,
        valid: chainBySession[r.session_id].results[idx].valid,
      });
    }
    res.json(sessions.map((s) => {
      const draws = bySession[s.id] || [];
      return { ...s, draws, all_valid: chainBySession[s.id] ? chainBySession[s.id].chain_valid : true };
    }));
  } catch (e) { next(e); }
});

// Public: one archived draw record + verification (same shape as /audit/:drawId)
router.get('/archive/:archiveId', async (req, res, next) => {
  try {
    const [[row]] = await pool.query('SELECT * FROM winners_archive WHERE id = ?', [req.params.archiveId]);
    if (!row) return res.status(404).json({ error: 'Archived draw not found.' });
    const [[prev]] = await pool.query(
      'SELECT verification_hash FROM winners_archive WHERE session_id = ? AND draw_order < ? ORDER BY draw_order DESC LIMIT 1',
      [row.session_id, row.draw_order]
    );
    const expectedPrev = prev ? prev.verification_hash : F.GENESIS_HASH;
    const beacon_check = await beaconApi.verifyBeacon(row);
    res.json({ record: row, verification: F.verifyDrawRecord(row, expectedPrev), beacon_check, expected_prev_hash: expectedPrev, algorithm: ALGORITHM_TEXT });
  } catch (e) { next(e); }
});

module.exports = router;
