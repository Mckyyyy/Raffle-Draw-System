/**
 * Independent verifier. Anyone with a copy of an audit record can run this
 * (e.g. from GET /api/winners/audit/:id or an export of the `winners` table).
 *
 *   node scripts/verify-draw.js audit.json
 *   node scripts/verify-draw.js --url http://localhost:4000/api/winners/audit/1
 */
const fs = require('fs');
const F = require('../src/fairness');
const beaconApi = require('../src/beacon');

async function main() {
  const [arg, val] = process.argv.slice(2);
  let record;
  if (arg === '--url') {
    const r = await fetch(val);
    const j = await r.json();
    record = j.record || j;
  } else if (arg) {
    const j = JSON.parse(fs.readFileSync(arg, 'utf8'));
    record = j.record || j;
  } else {
    console.log('Usage: node scripts/verify-draw.js <audit.json> | --url <audit url>');
    process.exit(1);
  }
  const result = F.verifyDrawRecord(record);
  console.log(JSON.stringify(result, null, 2));
  if (record.beacon_round != null) {
    const b = await beaconApi.verifyBeacon(record);
    console.log('\nBeacon (drand round ' + record.beacon_round + '): ' + (b.checked ? (b.matches ? 'MATCHES the public beacon' : 'DOES NOT MATCH the public beacon!') : 'could not check - ' + b.reason));
    if (b.checked && !b.matches) result.valid = false;
  } else {
    console.log('\nBeacon: none in this record (local randomness only).');
  }
  console.log(result.valid ? '\nVALID - all checks passed.' : '\nINVALID - one or more checks failed!');
  process.exit(result.valid ? 0 : 2);
}
main().catch((e) => { console.error(e); process.exit(1); });
