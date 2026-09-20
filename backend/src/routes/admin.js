const express = require('express');
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/admin/reset  { note?: string }
 * Archives the current draw session (every winners row, with the participant's
 * name/code denormalized) into draw_sessions + winners_archive, then clears
 * winners and sets every participant's is_winner back to FALSE.
 * Nothing is permanently deleted.
 */
router.post('/reset', requireAdmin, async (req, res, next) => {
  const note = String(req.body?.note || '').trim().slice(0, 255) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[stats]] = await conn.query(
      `SELECT COUNT(*) AS total_draws, MIN(drawn_at) AS first_draw_at, MAX(drawn_at) AS last_draw_at
       FROM winners FOR UPDATE`
    );
    const [[{ total_participants }]] = await conn.query('SELECT COUNT(*) AS total_participants FROM participants');

    let sessionId = null;
    if (stats.total_draws > 0) {
      const [s] = await conn.query(
        `INSERT INTO draw_sessions (first_draw_at, last_draw_at, total_draws, total_participants, note)
         VALUES (?, ?, ?, ?, ?)`,
        [stats.first_draw_at, stats.last_draw_at, stats.total_draws, total_participants, note]
      );
      sessionId = s.insertId;
      await conn.query(
        `INSERT INTO winners_archive
           (session_id, original_draw_id, participant_id, full_name, entry_code, draw_order, drawn_at,
            draw_seed, server_seed, server_seed_hash, client_seed, prev_hash, pick_index, committed_at,
            beacon_chain, beacon_round, beacon_randomness,
            random_index, pool_size, pool_snapshot, snapshot_hash, verification_hash)
         SELECT ?, w.id, w.participant_id, p.full_name, p.entry_code, w.draw_order, w.drawn_at,
                w.draw_seed, w.server_seed, w.server_seed_hash, w.client_seed, w.prev_hash, w.pick_index, w.committed_at,
                w.beacon_chain, w.beacon_round, w.beacon_randomness,
                w.random_index, w.pool_size, w.pool_snapshot, w.snapshot_hash, w.verification_hash
         FROM winners w JOIN participants p ON p.id = w.participant_id
         ORDER BY w.draw_order`,
        [sessionId]
      );
    }

    await conn.query('DELETE FROM winners');
    await conn.query('UPDATE participants SET is_winner = FALSE');

    await conn.commit();
    res.json({ ok: true, archived_draws: stats.total_draws, session_id: sessionId });
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    next(e);
  } finally {
    conn.release();
  }
});

/**
 * Clearing the archive is the ONE permanent deletion in the system, so it is
 * admin-only and the UI asks for typed confirmation. winners_archive rows go
 * with their session via ON DELETE CASCADE.
 */
router.delete('/archive', requireAdmin, async (req, res, next) => {
  try {
    const [[{ sessions }]] = await pool.query('SELECT COUNT(*) AS sessions FROM draw_sessions');
    const [[{ draws }]] = await pool.query('SELECT COUNT(*) AS draws FROM winners_archive');
    await pool.query('DELETE FROM draw_sessions');
    res.json({ ok: true, deleted_sessions: sessions, deleted_draws: draws });
  } catch (e) { next(e); }
});

router.delete('/archive/:sessionId', requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.sessionId);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid session id.' });
    const [[{ draws }]] = await pool.query('SELECT COUNT(*) AS draws FROM winners_archive WHERE session_id = ?', [id]);
    const [r] = await pool.query('DELETE FROM draw_sessions WHERE id = ?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Archived session not found.' });
    res.json({ ok: true, deleted_sessions: 1, deleted_draws: draws });
  } catch (e) { next(e); }
});

module.exports = router;
