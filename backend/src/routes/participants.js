const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { extractNames, ImportError } = require('../importParser');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function drawHasStarted() {
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM winners');
  return count > 0;
}

/**
 * Entry codes are an internal unique identifier only. Users never supply them
 * (the import file is names only); the server generates one per participant.
 * Format: GL-XXXXXX (uppercase hex from the CSPRNG). Uniqueness is enforced by
 * the UNIQUE index; on the rare collision we simply try again.
 */
function generateEntryCode() {
  return `GL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Normalised form used to spot the same person entered twice ("JUAN  DELA CRUZ" == "juan dela cruz"). */
const nameKey = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

async function existingNameKeys(conn) {
  const [rows] = await conn.query('SELECT full_name FROM participants');
  return new Set(rows.map((r) => nameKey(r.full_name)));
}

async function insertParticipant(conn, fullName, entryCode) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = entryCode || generateEntryCode();
    try {
      const [r] = await conn.query('INSERT INTO participants (full_name, entry_code) VALUES (?, ?)', [fullName, code]);
      return { id: r.insertId, entry_code: code };
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY' && !entryCode) continue; // generated collision → retry
      throw e;
    }
  }
  throw new Error('Could not generate a unique entry code');
}

// Public: participant list. Default = non-winners only. ?all=1 returns everyone.
router.get('/', async (req, res, next) => {
  try {
    const all = req.query.all === '1';
    const [rows] = await pool.query(
      `SELECT id, full_name, entry_code, is_winner, created_at
       FROM participants ${all ? '' : 'WHERE is_winner = FALSE'} ORDER BY id`
    );
    res.json(rows);
  } catch (e) { next(e); }
});

// Public: CSV export of the full pool (transparency layer before the event)
router.get('/export.csv', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, full_name, entry_code, is_winner FROM participants ORDER BY id'
    );
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['id,full_name,entry_code,is_winner'];
    for (const r of rows) {
      lines.push([r.id, esc(r.full_name), esc(r.entry_code), r.is_winner ? 1 : 0].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="participants.csv"');
    res.send(lines.join('\n'));
  } catch (e) { next(e); }
});

// Admin: add one participant (entry_code optional — generated when omitted)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    if (await drawHasStarted()) {
      return res.status(409).json({ error: 'The draw has already started. Participants can no longer be added.' });
    }
    const fullName = String(req.body?.full_name || '').trim();
    const entryCode = String(req.body?.entry_code || '').trim() || null;
    if (!fullName) return res.status(400).json({ error: 'full_name is required.' });
    // One person = one ticket. A duplicate name would double that person's chance.
    if (!req.body?.allow_duplicate && (await existingNameKeys(pool)).has(nameKey(fullName))) {
      return res.status(409).json({
        error: `"${fullName}" is already in the pool. Adding it again would give that person two chances. If this is a different person with the same name, add a distinguishing detail (e.g. a middle initial).`,
        duplicate: true,
      });
    }
    const r = await insertParticipant(pool, fullName, entryCode);
    res.status(201).json(r);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Duplicate entry_code.' });
    next(e);
  }
});

/** Shared bulk insert: names[] → { inserted, skipped, errors[] } inside one transaction */
/** Empty the list and restart ids at 1. Only ever called when winners is empty, so no draw can reference old ids. */
async function clearParticipants(conn) {
  const [d] = await conn.query('DELETE FROM participants');
  await conn.query('ALTER TABLE participants AUTO_INCREMENT = 1'); // DDL: commits implicitly, so it runs before any transaction
  return d.affectedRows;
}

async function bulkInsert(names, { replace = false } = {}) {
  const conn = await pool.getConnection();
  try {
    let removed = 0;
    if (replace) removed = await clearParticipants(conn);       // start from an empty list with ids from 1
    await conn.beginTransaction();
    let inserted = 0, skipped = 0;
    const errors = [];
    const duplicates = [];
    const seen = await existingNameKeys(conn);               // already in the pool + seen earlier in this file
    for (const [i, raw] of names.entries()) {
      const name = String(raw || '').trim();
      if (!name) { skipped++; continue; }                       // blank rows are ignored
      if (name.length > 150) { skipped++; errors.push(`Row ${i + 2}: name longer than 150 characters`); continue; }
      const key = nameKey(name);
      if (seen.has(key)) { skipped++; duplicates.push(name); continue; }  // one person = one ticket
      seen.add(key);
      await insertParticipant(conn, name, null);
      inserted++;
    }
    await conn.commit();
    return { inserted, skipped, removed, duplicates: duplicates.slice(0, 50), duplicate_count: duplicates.length, errors: errors.slice(0, 50) };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// Admin: import a file — CSV / TXT / XLSX / XLS / DOCX / DOC / PDF. Names are detected automatically; no header needed.
router.post('/import', requireAdmin, upload.single('file'), async (req, res, next) => {
  try {
    if (await drawHasStarted()) {
      return res.status(409).json({ error: 'The draw has already started. Import is no longer allowed.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const names = await extractNames(req.file); // throws ImportError when nothing name-like is found
    const replace = req.body?.replace === '1' || req.body?.replace === 'true';
    res.json({ ...(await bulkInsert(names, { replace })), file: req.file.originalname, detected: names.length });
  } catch (e) {
    if (e instanceof ImportError) return res.status(400).json({ error: e.message, detail: e.detail });
    next(e);
  }
});

// Admin: bulk import from JSON ({ participants: [{ full_name }] } or { names: [] })
router.post('/bulk', requireAdmin, async (req, res, next) => {
  try {
    if (await drawHasStarted()) {
      return res.status(409).json({ error: 'The draw has already started. Import is no longer allowed.' });
    }
    const items = Array.isArray(req.body?.participants) ? req.body.participants.map((p) => p?.full_name)
      : Array.isArray(req.body?.names) ? req.body.names : [];
    if (items.length === 0) return res.status(400).json({ error: 'The list is empty.' });
    res.json(await bulkInsert(items));
  } catch (e) { next(e); }
});

// Admin: remove EVERY participant — ONLY before the draw starts. Used to start a fresh list.
router.delete('/', requireAdmin, async (req, res, next) => {
  try {
    if (await drawHasStarted()) {
      return res.status(409).json({
        error: 'The draw has already started. Archive & Reset first, then the list can be cleared.',
      });
    }
    const deleted = await clearParticipants(pool);
    res.json({ ok: true, deleted });
  } catch (e) { next(e); }
});

// Admin: remove participant — ONLY before the draw starts (rule #8)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    if (await drawHasStarted()) {
      return res.status(409).json({
        error: 'The draw has already started. Participants can no longer be removed (no manual override).',
      });
    }
    const [r] = await pool.query('DELETE FROM participants WHERE id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Participant not found.' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
