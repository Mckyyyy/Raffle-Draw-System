import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getToken } from '../api.js';
import { verifyDrawRecord, checkBeaconOnline, drandRoundUrl } from '../verify.js';
import PageHeader from '../components/PageHeader.jsx';

const CHECK_LABELS = {
  commitment_matches: 'Commitment — SHA-256 of the revealed server seed equals the hash shown before the draw',
  seed_derivation_matches: 'Seed derivation — draw seed = SHA-256(server seed | client seed | previous hash | pick index)',
  chain_link_matches: 'Chain link — previous-hash field equals the verification hash of the draw before it',
  snapshot_hash_matches: 'Snapshot hash — the logged pool matches its hash',
  pool_size_matches: 'Pool size — the number of participants in the snapshot matches',
  random_index_matches: 'Random index — SHA-256(seed) mod pool_size matches',
  winner_matches: 'Winner — the participant at that index is the logged winner',
  verification_hash_matches: 'Verification hash — the whole record matches',
};

export default function Audit() {
  const { drawId } = useParams();
  return drawId ? <AuditDetail drawId={drawId} /> : <AuditLog />;
}

function AuditLog() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});
  useEffect(() => { api.auditAll().then(setData).catch((e) => setError(e.message)); }, []);

  return (
    <div className="pg">
      <PageHeader
        title="Audit / Verify"
        subtitle="Every draw is logged with its commitment, seeds, and a snapshot of the pool right before the pick. Anyone can recompute the result here — the browser does the math."
      />
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <div className={`banner ${data.all_valid ? 'ok' : 'bad'}`}>
            {data.results.length === 0
              ? 'No draws yet.'
              : data.all_valid ? `All ${data.results.length} draws are VALID and the hash chain is intact (server check).` : 'ONE OR MORE DRAWS ARE INVALID OR THE CHAIN IS BROKEN!'}
            {data.chain_head && data.results.length > 0 && (
              <div className="muted small">Chain head (latest verification hash): <code>{data.chain_head}</code></div>
            )}
          </div>

          <details className="pg-panel pg-details">
            <summary><h3>How a winner is computed</h3></summary>
            <ol className="algo">{data.algorithm.map((l) => <li key={l}><code>{l}</code></li>)}</ol>
          </details>

          {data.results.length > 0 && (
            <section className="pg-panel">
              <h3>Draw log</h3>
              <div className="table-wrap">
                <table className="pg-table">
                  <thead>
                    <tr><th>#</th><th>Timestamp</th><th>Winner</th><th>Pool</th><th>Commitment</th><th>Server check</th><th></th></tr>
                  </thead>
                  <tbody>
                    {data.results.map((r) => (
                      <RowGroup key={r.draw_id} r={r} open={!!open[r.draw_id]}
                        toggle={() => setOpen((o) => ({ ...o, [r.draw_id]: !o[r.draw_id] }))} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Raw JSON: <a href="/api/winners/audit" target="_blank" rel="noreferrer">/api/winners/audit</a>
              </p>
            </section>
          )}
        </>
      )}
      <ArchivedSessions />
    </div>
  );
}

function ArchivedSessions() {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState({});
  const [pending, setPending] = useState(null); // session id awaiting a second click, or 'all'
  const isAdmin = !!getToken();

  const load = () => api.archive().then(setSessions).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  // Two-step delete: first click arms the button, second click within 5 s confirms.
  const arm = (id) => { setPending(id); setTimeout(() => setPending((p) => (p === id ? null : p)), 5000); };
  const remove = async (id) => {
    setError(''); setMsg('');
    try {
      const r = id === 'all' ? await api.clearArchive() : await api.deleteArchivedSession(id);
      setMsg(id === 'all'
        ? `Cleared ${r.deleted_sessions} archived session${r.deleted_sessions === 1 ? '' : 's'} (${r.deleted_draws} draws).`
        : `Deleted session #${id} (${r.deleted_draws} draws).`);
      setPending(null);
      await load();
    } catch (e) { setError(e.message); setPending(null); }
  };

  if (error && !sessions) return <p className="error">{error}</p>;
  if (!sessions || sessions.length === 0) return msg ? <p className="ok-text">{msg}</p> : null;

  return (
    <section className="pg-panel">
      <div className="page-head">
        <h3>Archived sessions ({sessions.length})</h3>
        {isAdmin && (
          <button
            className={`btn-danger ${pending === 'all' ? 'btn-solid' : ''}`}
            onClick={() => (pending === 'all' ? remove('all') : arm('all'))}
          >
            {pending === 'all' ? 'Click again to permanently clear ALL archived sessions' : 'Clear all archived sessions'}
          </button>
        )}
      </div>
      <p className="muted small">
        Previous raffle runs, archived by an Admin reset. Every archived draw keeps its seed and pool snapshot and is
        re-verified here the same way as the current session.
        {isAdmin && ' Deleting an archived session is permanent.'}
      </p>
      {msg && <p className="ok-text">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {sessions.map((s) => (
        <details key={s.id} className="archive-session" open={!!open[s.id]}
          onToggle={(e) => setOpen((o) => ({ ...o, [s.id]: e.target.open }))}>
          <summary>
            <b>Session #{s.id}</b>{s.note ? ` — ${s.note}` : ''} · {s.total_draws} draw{s.total_draws === 1 ? '' : 's'} of {s.total_participants} participants
            · {s.first_draw_at ? new Date(s.first_draw_at).toLocaleString() : '—'} → {s.last_draw_at ? new Date(s.last_draw_at).toLocaleTimeString() : '—'}
            · archived {new Date(s.archived_at).toLocaleString()}
            · <span className={s.all_valid ? 'ok-text' : 'bad-text'}>{s.all_valid ? 'ALL VALID' : 'INVALID'}</span>
            {isAdmin && (
              <button
                className={`btn-danger archive-delete ${pending === s.id ? 'btn-solid' : ''}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); pending === s.id ? remove(s.id) : arm(s.id); }}
              >
                {pending === s.id ? 'Confirm delete' : 'Delete'}
              </button>
            )}
          </summary>
          <div className="table-wrap">
            <table className="pg-table">
              <thead><tr><th>#</th><th>Timestamp</th><th>Winner</th><th>Pool</th><th>Seed</th><th>Server check</th><th></th></tr></thead>
              <tbody>
                {s.draws.map((d) => (
                  <tr key={d.archive_id}>
                    <td><b>{d.draw_order}</b></td>
                    <td>{new Date(d.drawn_at).toLocaleString()}</td>
                    <td>{d.full_name} <code>{d.entry_code}</code></td>
                    <td>index {d.random_index} of {d.pool_size}</td>
                    <td><code className="seed">{d.draw_seed}</code></td>
                    <td className={d.valid ? 'ok-text' : 'bad-text'}>{d.valid ? 'VALID' : 'INVALID'}</td>
                    <td><a href={`/api/winners/archive/${d.archive_id}`} target="_blank" rel="noreferrer">raw record</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}

function RowGroup({ r, open, toggle }) {
  return (
    <>
      <tr>
        <td><b>{r.draw_order}</b></td>
        <td>{new Date(r.drawn_at).toLocaleString()}</td>
        <td>{r.full_name} <code>{r.entry_code}</code></td>
        <td>
          index {r.random_index} of {r.pool_size}{' '}
          <button className="btn-link" onClick={toggle}>{open ? 'hide snapshot' : 'show snapshot'}</button>
        </td>
        <td>
          {r.server_seed_hash
            ? <><code className="seed" title={r.server_seed_hash}>{r.server_seed_hash}</code><div className="muted small">published {r.committed_at ? new Date(r.committed_at).toLocaleTimeString() : '—'}{r.beacon_round != null ? ` · drand #${r.beacon_round}` : ' · no beacon'}</div></>
            : <span className="muted small">legacy (no commitment)</span>}
        </td>
        <td className={r.valid ? 'ok-text' : 'bad-text'}>{r.valid ? 'VALID' : 'INVALID'}</td>
        <td><Link to={`/audit/${r.draw_id}`}>verify in browser →</Link></td>
      </tr>
      {open && (
        <tr className="snapshot-row">
          <td colSpan={7}>
            <div className="muted small">Pool snapshot before draw #{r.draw_order} ({r.pool_size} participants) · hash <code>{r.snapshot_hash}</code></div>
            <ol start={0} className="snapshot-list">
              {r.pool_snapshot.map((p, i) => (
                <li key={p.id} className={i === r.random_index ? 'picked' : ''}>
                  {p.full_name} <code>{p.entry_code}</code>{i === r.random_index ? ' ← selected' : ''}
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}

function AuditDetail({ drawId }) {
  const [data, setData] = useState(null);
  const [client, setClient] = useState(null);
  const [beacon, setBeacon] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null); setClient(null); setBeacon(null); setError('');
    api.audit(drawId)
      .then(async (d) => {
        setData(d);
        setClient(await verifyDrawRecord(d.record, d.expected_prev_hash));
        if (d.record.beacon_round != null) setBeacon(await checkBeaconOnline(d.record)); // the browser asks drand directly
      })
      .catch((e) => setError(e.message));
  }, [drawId]);

  if (error) return <p className="error">{error}</p>;
  if (!data || !client) return <p className="muted">Loading and recomputing…</p>;

  const r = data.record;
  const snapshot = typeof r.pool_snapshot === 'string' ? JSON.parse(r.pool_snapshot) : r.pool_snapshot;

  return (
    <div className="pg">
      <PageHeader
        title={`Draw No. ${r.draw_order}`}
        subtitle={`Drawn ${new Date(r.drawn_at).toLocaleString()}`}
        right={<Link className="pg-link" to="/audit">← all draws</Link>}
        compact
      />

      <div className={`banner ${client.valid ? 'ok' : 'bad'}`}>
        {client.valid
          ? 'VALID — your browser recomputed the result and it matches the logged winner.'
          : 'INVALID — the recomputation does not match. This needs investigation.'}
        <div className="muted small">Server check: {data.verification.valid ? 'VALID' : 'INVALID'}</div>
      </div>

      <section className="pg-spotlight">
        <div className="pg-spotlight-kicker">Winner · No. {r.draw_order}</div>
        <div className="pg-spotlight-name"><span aria-hidden="true">🏆</span> {r.full_name}</div>
        <div className="pg-spotlight-meta">entry code <code>{r.entry_code}</code> · participant id {r.participant_id}</div>
      </section>

      <section className="pg-panel">
      {client.scheme !== 'legacy' ? (
        <>
          <h3>Provably-fair inputs</h3>
          <table className="kv"><tbody>
            <tr><td>Commitment shown before the draw</td><td><code>{r.server_seed_hash}</code>{r.committed_at && <div className="muted small">published {new Date(r.committed_at).toLocaleString()} · drawn {new Date(r.drawn_at).toLocaleString()}</div>}</td></tr>
            <tr><td>Server seed (revealed after)</td><td><code>{r.server_seed}</code></td></tr>
            <tr><td>Client seed (browser nonce)</td><td><code>{r.client_seed || '(none)'}</code></td></tr>
            <tr><td>Previous draw hash (chain)</td><td><code>{r.prev_hash}</code></td></tr>
            <tr><td>Pick index in batch</td><td>{r.pick_index}</td></tr>
            <tr><td>Public beacon (drand)</td><td>
              {r.beacon_round != null ? (
                <>
                  round <b>{r.beacon_round}</b> · <code>{r.beacon_randomness}</code>
                  <div className="muted small">
                    <a href={drandRoundUrl(r.beacon_round)} target="_blank" rel="noreferrer">view this round on drand.sh ↗</a>
                    {' · '}
                    {beacon === null ? 'checking with drand…'
                      : beacon.checked ? <span className={beacon.matches ? 'ok-text' : 'bad-text'}>{beacon.matches ? '✔ browser confirmed it with drand' : '✘ DOES NOT MATCH drand'}</span>
                      : <span>could not check ({beacon.reason})</span>}
                    {data.beacon_check?.checked && <span> · server check: {data.beacon_check.matches ? 'match' : 'MISMATCH'}</span>}
                  </div>
                </>
              ) : <span className="muted">none — local randomness only (beacon off or no internet at draw time)</span>}
            </td></tr>
          </tbody></table>
        </>
      ) : (
        <p className="muted small">This draw was recorded before the commit–reveal scheme; only the seed/snapshot checks apply.</p>
      )}

      <h3>Record</h3>
      <table className="kv"><tbody>
        <tr><td>Draw ID</td><td>{r.id}</td></tr>
        <tr><td>Draw order</td><td>{r.draw_order}</td></tr>
        <tr><td>Drawn at</td><td>{new Date(r.drawn_at).toLocaleString()}</td></tr>
        <tr><td>Participant ID</td><td>{r.participant_id}</td></tr>
        <tr><td>Pool size</td><td>{r.pool_size}</td></tr>
        <tr><td>Draw seed{client.scheme !== 'legacy' ? ' (derived)' : ''}</td><td><code>{r.draw_seed}</code></td></tr>
        <tr><td>Random index</td><td>{r.random_index} (position {r.random_index + 1} in the sorted pool)</td></tr>
        <tr><td>Snapshot hash</td><td><code>{r.snapshot_hash}</code></td></tr>
        <tr><td>Verification hash</td><td><code>{r.verification_hash}</code></td></tr>
      </tbody></table>

      </section>

      <section className="pg-panel">
      <h3>Browser re-verification</h3>
      <ul className="checks">
        {Object.entries(client.checks).map(([k, v]) => (
          <li key={k} className={v ? 'ok-text' : 'bad-text'}>{v ? '✔' : '✘'} {CHECK_LABELS[k] || k}</li>
        ))}
      </ul>
      <table className="kv"><tbody>
        <tr><td>Recomputed SHA-256(seed) mod {client.recomputed.pool_size}</td><td>{client.recomputed.random_index}</td></tr>
        <tr><td>Recomputed winner</td><td>{client.recomputed.winner?.full_name} (id {client.recomputed.winner?.id})</td></tr>
        <tr><td>Recomputed snapshot hash</td><td><code>{client.recomputed.snapshot_hash}</code></td></tr>
        <tr><td>Recomputed verification hash</td><td><code>{client.recomputed.verification_hash}</code></td></tr>
      </tbody></table>

      </section>

      <section className="pg-panel">
      <h3>Pool snapshot before the draw ({snapshot.length})</h3>
      <div className="table-wrap">
        <table className="pg-table">
          <thead><tr><th>Index</th><th>ID</th><th>Name</th><th>Entry code</th></tr></thead>
          <tbody>
            {snapshot.map((p, i) => (
              <tr key={p.id} className={i === r.random_index ? 'latest' : ''}>
                <td>{i}</td><td>{p.id}</td><td>{p.full_name}</td><td><code>{p.entry_code}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Raw JSON: <a href={`/api/winners/audit/${r.id}`} target="_blank" rel="noreferrer">/api/winners/audit/{r.id}</a>
        {' '}— can also be verified offline with <code>backend/scripts/verify-draw.js</code>.
      </p>
      </section>
    </div>
  );
}
