/**
 * Public randomness beacon (drand "quicknet", https://drand.love).
 *
 * drand publishes a new, unpredictable, publicly verifiable random value every
 * 3 seconds, produced jointly by independent organisations (Cloudflare, EPFL,
 * Kudelski, …). Mixing the FIRST round published AFTER the draw request into
 * the seed means nobody in the room — not even someone who controls both the
 * server and the laptop — can know the final randomness when they press the
 * button. Anyone can later fetch the same round from drand and confirm it.
 *
 * If drand cannot be reached (no internet at the venue) the draw proceeds
 * with local randomness only and the record says so (beacon_round NULL).
 */
const CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971'; // quicknet
const GENESIS = 1692803367; // unix seconds
const PERIOD = 3;           // seconds
const MIRRORS = [
  `https://api.drand.sh/${CHAIN}`,
  `https://drand.cloudflare.com/${CHAIN}`,
  `https://api2.drand.sh/${CHAIN}`,
];

const enabled = () => (process.env.BEACON || 'on').toLowerCase() !== 'off';

/** Round number whose publication time is the latest at or before `unixSec`. */
function roundAt(unixSec) {
  return Math.floor((unixSec - GENESIS) / PERIOD) + 1;
}

async function fetchRound(round, timeoutMs = 2500) {
  let lastErr;
  for (const base of MIRRORS) {
    try {
      const r = await fetch(`${base}/public/${round}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 404) return null;                    // not published yet
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (Number(j.round) !== round || !/^[0-9a-f]{64}$/.test(j.randomness || '')) throw new Error('bad beacon payload');
      return { chain: CHAIN, round, randomness: j.randomness, signature: j.signature };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('beacon unreachable');
}

/**
 * The first beacon round strictly AFTER `requestMs`. Waits for it to be
 * published (≤ 3 s + network). Returns null when the beacon is disabled or
 * unreachable within `maxWaitMs`.
 */
// Offline venues: probe once with a short timeout and remember the answer for a minute,
// so a draw never waits on a network that is not there.
let offlineUntil = 0;
async function reachable() {
  if (Date.now() < offlineUntil) return false;
  for (const base of MIRRORS) {
    try {
      const r = await fetch(`${base}/info`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* next mirror */ }
  }
  offlineUntil = Date.now() + 60_000;
  return false;
}

/**
 * The first beacon round strictly AFTER `requestMs`. Waits for it to be
 * published (≤ 3 s + network). Returns null when the beacon is disabled or
 * unreachable.
 */
async function beaconAfter(requestMs, { maxWaitMs = 9000 } = {}) {
  if (!enabled()) return null;
  if (!(await reachable())) return null;
  const target = roundAt(requestMs / 1000) + 1;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const b = await fetchRound(target);
      if (b) return b;
    } catch { /* retry until deadline */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Re-fetch a recorded round and compare — used by the audit endpoints. */
async function verifyBeacon(record) {
  if (record.beacon_round == null) return { checked: false, reason: 'no beacon in record' };
  try {
    const b = await fetchRound(Number(record.beacon_round), 4000);
    if (!b) return { checked: false, reason: 'round not found on drand' };
    return { checked: true, matches: b.randomness === record.beacon_randomness, drand_randomness: b.randomness };
  } catch (e) {
    return { checked: false, reason: `drand unreachable: ${e.message}` };
  }
}

module.exports = { CHAIN, GENESIS, PERIOD, roundAt, fetchRound, beaconAfter, verifyBeacon, enabled, reachable };
