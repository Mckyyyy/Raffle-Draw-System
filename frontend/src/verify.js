/**
 * Client-side (browser) re-verification of a draw record.
 * Uses Web Crypto — no trust in the server; the browser itself recomputes everything.
 * Must match the algorithm in backend/src/fairness.js EXACTLY.
 */
export const GENESIS_HASH = '0'.repeat(64);

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function serializeSnapshot(rows) {
  return JSON.stringify(
    rows.map((r) => ({ id: r.id, full_name: r.full_name, entry_code: r.entry_code }))
        .sort((a, b) => a.id - b.id)
  );
}

/**
 * @param record        the draw row (live or archived)
 * @param expectedPrev  verification_hash of the previous draw (or GENESIS_HASH); omit to skip the chain check
 */
export async function verifyDrawRecord(record, expectedPrev) {
  const snapshot = typeof record.pool_snapshot === 'string' ? JSON.parse(record.pool_snapshot) : record.pool_snapshot;
  const snapshotJson = serializeSnapshot(snapshot);
  const snapshotHash = await sha256(snapshotJson);
  const poolSize = snapshot.length;
  const committed = record.server_seed != null && record.server_seed !== '';

  const checks = {};
  let seed = record.draw_seed;
  if (committed) {
    const base = `${record.server_seed}|${record.client_seed ?? ''}|${record.prev_hash}|${Number(record.pick_index)}`;
    const derived = await sha256(record.beacon_round != null ? `${base}|${Number(record.beacon_round)}:${record.beacon_randomness}` : base);
    checks.commitment_matches = (await sha256(record.server_seed)) === record.server_seed_hash;
    checks.seed_derivation_matches = derived === record.draw_seed;
    seed = derived;
  }

  const seedHash = await sha256(seed);
  const expectedIndex = poolSize > 0 ? Number(BigInt('0x' + seedHash) % BigInt(poolSize)) : -1;
  const expectedWinner = snapshot[expectedIndex];
  const expectedVerification = await sha256(
    `${snapshotHash}|${seed}|${expectedIndex}|${expectedWinner ? expectedWinner.id : null}`
  );

  checks.snapshot_hash_matches = snapshotHash === record.snapshot_hash;
  checks.pool_size_matches = poolSize === Number(record.pool_size);
  checks.random_index_matches = expectedIndex === Number(record.random_index);
  checks.winner_matches = !!expectedWinner && expectedWinner.id === Number(record.participant_id);
  checks.verification_hash_matches = expectedVerification === record.verification_hash;
  if (committed && expectedPrev !== undefined) checks.chain_link_matches = record.prev_hash === expectedPrev;

  return {
    valid: Object.values(checks).every(Boolean),
    scheme: !committed ? 'legacy' : record.beacon_round != null ? 'commit-reveal+beacon' : 'commit-reveal',
    checks,
    recomputed: { snapshot_hash: snapshotHash, pool_size: poolSize, draw_seed: seed, random_index: expectedIndex, winner: expectedWinner, verification_hash: expectedVerification },
  };
}

/** drand quicknet — public randomness beacon. Fetch a round straight from drand (independent of our server). */
export const DRAND_CHAIN = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export const drandRoundUrl = (round) => `https://api.drand.sh/${DRAND_CHAIN}/public/${round}`;
export async function checkBeaconOnline(record) {
  if (record.beacon_round == null) return { checked: false, reason: 'no beacon in record' };
  for (const base of [`https://api.drand.sh/${DRAND_CHAIN}`, `https://drand.cloudflare.com/${DRAND_CHAIN}`]) {
    try {
      const r = await fetch(`${base}/public/${record.beacon_round}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      return { checked: true, matches: j.randomness === record.beacon_randomness, drand_randomness: j.randomness };
    } catch { /* try next mirror */ }
  }
  return { checked: false, reason: 'drand not reachable from this browser' };
}

/** Random client nonce for the draw (16 bytes from the browser's CSPRNG). */
export function browserNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
