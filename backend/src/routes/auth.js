const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' });

const router = express.Router();
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 12;

/**
 * Load the single admin account. If the table is empty (first run), seed it
 * from ADMIN_PASSWORD in .env so the documented setup keeps working; from then
 * on the password lives only in the database and is changed via the Admin page.
 */
async function getAdmin() {
  const [[row]] = await pool.query('SELECT * FROM admin_account WHERE id = 1');
  if (row) return row;
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, BCRYPT_ROUNDS);
  await pool.query('INSERT INTO admin_account (id, password_hash) VALUES (1, ?)', [hash]);
  const [[seeded]] = await pool.query('SELECT * FROM admin_account WHERE id = 1');
  return seeded;
}

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    const admin = await getAdmin();
    if (!password || !(await bcrypt.compare(String(password), admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid password.' });
    }
    const token = jwt.sign({ role: 'admin', pw: admin.password_changed_at ? +new Date(admin.password_changed_at) : 0 },
      process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token });
  } catch (e) { next(e); }
});

// Profile info shown on the Admin page
router.get('/me', requireAdmin, async (req, res, next) => {
  try {
    const admin = await getAdmin();
    res.json({
      display_name: admin.display_name,
      password_changed_at: admin.password_changed_at,
      using_default_password: !admin.password_changed_at,
      min_password_length: MIN_PASSWORD_LENGTH,
    });
  } catch (e) { next(e); }
});

router.post('/change-password', requireAdmin, async (req, res, next) => {
  try {
    const current = String(req.body?.current_password || '');
    const next_ = String(req.body?.new_password || '');
    const confirm = String(req.body?.confirm_password || '');

    if (!current || !next_ || !confirm) return res.status(400).json({ error: 'All three fields are required.' });
    if (next_.length < MIN_PASSWORD_LENGTH) return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` });
    if (next_ !== confirm) return res.status(400).json({ error: 'New password and confirmation do not match.' });
    if (next_ === current) return res.status(400).json({ error: 'New password must be different from the current one.' });

    const admin = await getAdmin();
    if (!(await bcrypt.compare(current, admin.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    const hash = await bcrypt.hash(next_, BCRYPT_ROUNDS);
    await pool.query('UPDATE admin_account SET password_hash = ?, password_changed_at = NOW() WHERE id = 1', [hash]);
    res.json({ ok: true, message: 'Password changed. Please log in again with the new password.' });
  } catch (e) { next(e); }
});

router.patch('/me', requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.display_name || '').trim().slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Display name is required.' });
    await getAdmin();
    await pool.query('UPDATE admin_account SET display_name = ? WHERE id = 1', [name]);
    res.json({ ok: true, display_name: name });
  } catch (e) { next(e); }
});

module.exports = router;
