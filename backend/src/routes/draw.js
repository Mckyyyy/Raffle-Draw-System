const express = require('express');
const pool = require('../db');
const { requireDrawKey } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const F = require('../fairness');
const beaconApi = require('../beacon');

const router = express.Router();

const MAX_COUNT = 10;
const MAX_CLIENT_SEED = 255;

// Wrong draw keys count as attempts too, so the key cannot be brute-forced from the venue network
const drawLimiter = rateLimit({ windowMs: 60_000, max: 30, message: 'Too many draw requests. Please wait a minute.' });

// In-process lock: only one draw request runs at a time.
// DB row locks (FOR UPDATE) act as the second layer of protection.
let drawInProgress = false;

/**
 * POST /api/draw/commit
 * Step C1–C2 of the fairness scheme: create a secret server seed and return
 * ONLY its hash. The Live Draw page shows this hash on screen before the
 * button is pressed. Reuses the latest unused commitment so the screen shows
 * one stable value.
 */
router.post('/commit', drawLimiter, requireDrawKey, async (req, res, next) => {
  try {
    const [[open]] = await pool.query(
      'SELECT id, server_seed_hash, created_at FROM draw_commitments WHERE used_at IS NULL ORDER BY id DESC LIMIT 1'
    );
    if (open) return res.json({ commit_id: open.id, server_seed_hash: open.server_seed_hash, created_at: open.created_at });
    const serverSeed = F.generateSeed();
    const hash = F.commitmentHash(serverSeed);
    const [r] = await pool.query('INSERT INTO draw_commitments (server_seed, server_seed_hash) VALUES (?, ?)', [serverSeed, hash]);
    const [[row]] = await pool.query('SELECT created_at FROM draw_commitments WHERE id = ?', [r.insertId]);
    res.json({ commit_id: r.insertId, server_seed_hash: hash, created_at: row.created_at });
  } catch (e) { next(e); }
});

/**
 * POST /api/draw  { count?: 1..10, commit_id?: number, client_seed?: string }
 * Draws `count` unique names in ONE transaction. Every name is its own draw:
 * its own pool snapshot (the pool shrinks by one after each pick), its own
 * derived seed, its own draw_order and its own audit row, chained to the
 * previous draw by prev_hash.
 */
router.post('/', drawLimiter, requireDrawKey, async (req, res, next) => {
  const count = Number(req.body?.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    return res.status(400).json({ error: `count must be a whole number from 1 to ${MAX_COUNT}.` });
  }
  const commitId = req.body?.commit_id == null ? null : Number(req.body.commit_id);
  if (commitId !== null && (!Number.isInteger(commitId) || commitId < 1)) {
    return res.status(400).json({ error: 'Invalid commit_id.' });
  }
  const clientSeed = String(req.body?.client_seed ?? '').slice(0, MAX_CLIENT_SEED);

  if (drawInProgress) {
    return res.status(429).json({ error: 'A draw is already in progress. Please wait.' });
  }
  drawInProgress = true;
  // Public beacon: the first drand round published AFTER this request arrived (null if offline / disabled).
  // Fetched before the transaction so no DB locks are held while waiting for the network.
  let conn;
  try {
    const beacon = await beaconApi.beaconAfter(Date.now());
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lock the whole remaining pool for the duration of the transaction
    const [rows] = await conn.query(
      'SELECT id, full_name, entry_code FROM participants WHERE is_winner = FALSE ORDER BY id FOR UPDATE'
    );
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'No participants left.' });
    }
    if (count > rows.length) {
      await conn.rollback();
      return res.status(400).json({
        error: `Only ${rows.length} participant${rows.length === 1 ? '' : 's'} left in the pool; cannot draw ${count}.`,
      });
    }

    // Resolve the server commitment (must be unused) and mark it used inside the same transaction
    let commit;
    if (commitId !== null) {
      const [[c]] = await conn.query('SELECT * FROM draw_commitments WHERE id = ? FOR UPDATE', [commitId]);
      if (!c) { await conn.rollback(); return res.status(400).json({ error: 'Unknown commitment. Reload the page to get a new one.' }); }
      if (c.used_at) { await conn.rollback(); return res.status(409).json({ error: 'That commitment was already used. Reload the page to get a new one.' }); }
      commit = c;
    } else {
      // API caller without a pre-published commitment: create one now (the audit shows committed_at == drawn_at)
      const serverSeed = F.generateSeed();
      const hash = F.commitmentHash(serverSeed);
      const [r] = await conn.query('INSERT INTO draw_commitments (server_seed, server_seed_hash) VALUES (?, ?)', [serverSeed, hash]);
      const [[c]] = await conn.query('SELECT * FROM draw_commitments WHERE id = ?', [r.insertId]);
      commit = c;
    }
    await conn.query('UPDATE draw_commitments SET used_at = NOW(3) WHERE id = ?', [commit.id]);

    // Chain link: the previous draw's verification hash (GENESIS if none)
    const [[last]] = await conn.query(
      'SELECT draw_order, verification_hash FROM winners ORDER BY draw_order DESC LIMIT 1 FOR UPDATE'
    );
    const lastOrder = last ? last.draw_order : 0;
    let prevHash = last ? last.verification_hash : F.GENESIS_HASH;

    let remaining = rows;
    const draws = [];
    for (let n = 0; n < count; n++) {
      // Fairness algorithm (see src/fairness.js), applied to the CURRENT pool
      const snapshotJson = F.serializeSnapshot(remaining);
      const snapshot = JSON.parse(snapshotJson);
      const snapshotHash = F.sha256(snapshotJson);
      const seed = F.deriveDrawSeed({ serverSeed: commit.server_seed, clientSeed, prevHash, pickIndex: n, beacon });
      const randomIndex = F.indexFromSeed(seed, snapshot.length);
      const winner = snapshot[randomIndex];
      const vHash = F.verificationHash({ snapshotHash, seed, randomIndex, participantId: winner.id });
      const drawOrder = lastOrder + n + 1;

      // Guarded by is_winner = FALSE so a double win is impossible
      const [upd] = await conn.query(
        'UPDATE participants SET is_winner = TRUE WHERE id = ? AND is_winner = FALSE',
        [winner.id]
      );
      if (upd.affectedRows !== 1) throw new Error('Winner row was modified concurrently');

      const [ins] = await conn.query(
        `INSERT INTO winners
          (participant_id, draw_order, draw_seed, server_seed, server_seed_hash, client_seed, prev_hash, pick_index,
           committed_at, beacon_chain, beacon_round, beacon_randomness,
           random_index, pool_size, pool_snapshot, snapshot_hash, verification_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [winner.id, drawOrder, seed, commit.server_seed, commit.server_seed_hash, clientSeed, prevHash, n,
          commit.created_at, beacon ? beacon.chain : null, beacon ? beacon.round : null, beacon ? beacon.randomness : null,
          randomIndex, snapshot.length, snapshotJson, snapshotHash, vHash]
      );

      draws.push({
        draw_id: ins.insertId,
        draw_order: drawOrder,
        winner: { id: winner.id, full_name: winner.full_name, entry_code: winner.entry_code },
        audit: {
          pool_size: snapshot.length,
          server_seed_hash: commit.server_seed_hash,
          server_seed: commit.server_seed,
          client_seed: clientSeed,
          prev_hash: prevHash,
          pick_index: n,
          beacon: beacon ? { round: beacon.round, randomness: beacon.randomness } : null,
          draw_seed: seed,
          random_index: randomIndex,
          snapshot_hash: snapshotHash,
          verification_hash: vHash,
        },
      });
      // The picked name leaves the pool; the chain moves forward
      remaining = remaining.filter((r) => r.id !== winner.id);
      prevHash = vHash;
    }

    await conn.commit();

    const ids = draws.map((d) => d.draw_id);
    const [times] = await pool.query('SELECT id, drawn_at FROM winners WHERE id IN (?)', [ids]);
    const timeById = Object.fromEntries(times.map((t) => [t.id, t.drawn_at]));
    for (const d of draws) d.drawn_at = timeById[d.draw_id];

    res.json({
      count: draws.length,
      draws,
      remaining: remaining.length,
      commitment: { commit_id: commit.id, server_seed_hash: commit.server_seed_hash, committed_at: commit.created_at },
      beacon: beacon ? { chain: beacon.chain, round: beacon.round, randomness: beacon.randomness } : null,
      chain_head: prevHash,
    });
  } catch (e) {
    try { if (conn) await conn.rollback(); } catch { /* ignore */ }
    next(e);
  } finally {
    if (conn) conn.release();
    drawInProgress = false;
  }
});

// Event status (for the UI): how many have won, how many remain, chain head
router.get('/status', async (req, res, next) => {
  try {
    const [[s]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM participants) AS total,
         (SELECT COUNT(*) FROM participants WHERE is_winner = FALSE) AS remaining,
         (SELECT COUNT(*) FROM winners) AS draws_done,
         (SELECT COUNT(*) FROM draw_sessions) AS archived_sessions,
         (SELECT verification_hash FROM winners ORDER BY draw_order DESC LIMIT 1) AS chain_head`
    );
    res.json({ ...s, chain_head: s.chain_head || F.GENESIS_HASH, draw_started: s.draws_done > 0, max_count: MAX_COUNT, beacon_enabled: beaconApi.enabled() });
  } catch (e) { next(e); }
});

module.exports = router;
