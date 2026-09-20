/**
 * Minimal in-memory rate limiter (per client IP). Enough to stop someone on
 * the venue network from brute-forcing the admin password or the draw key.
 * Single-process only — fine for this app.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let h = hits.get(ip);
    if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + windowMs }; hits.set(ip, h); }
    h.count++;
    if (h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.resetAt - now) / 1000));
      return res.status(429).json({ error: message || 'Too many attempts. Please wait a moment and try again.' });
    }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k); // housekeeping
    next();
  };
}

module.exports = { rateLimit };
