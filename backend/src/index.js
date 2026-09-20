require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./db');

const missing = ['JWT_SECRET', 'ADMIN_PASSWORD', 'DRAW_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'error', details: e.message });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/participants', require('./routes/participants'));
app.use('/api/draw', require('./routes/draw'));
app.use('/api/winners', require('./routes/winners'));
app.use('/api/admin', require('./routes/admin'));
// Alias per the spec: GET /api/audit-log/:drawId
app.get('/api/audit-log/:drawId', (req, res) =>
  res.redirect(307, `/api/winners/audit/${req.params.drawId}`));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Server error', details: err.message });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`Raffle API running on http://localhost:${PORT}`));
