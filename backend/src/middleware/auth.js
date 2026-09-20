const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Admin login required.' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('bad role');
  } catch {
    return res.status(401).json({ error: 'Invalid or expired admin session.' });
  }
  try {
    // Sessions issued before the last password change are no longer valid
    const [[row]] = await pool.query('SELECT password_changed_at FROM admin_account WHERE id = 1');
    const changedAt = row?.password_changed_at ? +new Date(row.password_changed_at) : 0;
    if ((payload.pw || 0) !== changedAt) {
      return res.status(401).json({ error: 'Invalid or expired admin session. Please log in again.' });
    }
  } catch (e) {
    return next(e);
  }
  req.admin = payload;
  next();
}

// The Live Draw page must send DRAW_KEY (header x-draw-key)
// so that not just anyone on the network can trigger a draw.
function requireDrawKey(req, res, next) {
  const key = req.headers['x-draw-key'] || '';
  if (!process.env.DRAW_KEY || !safeEqual(key, process.env.DRAW_KEY)) {
    return res.status(403).json({ error: 'Invalid draw key.' });
  }
  next();
}

module.exports = { requireAdmin, requireDrawKey, safeEqual };
