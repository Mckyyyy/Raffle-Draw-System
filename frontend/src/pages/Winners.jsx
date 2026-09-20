import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';

const POLL_MS = 3000;

export default function Winners() {
  const [winners, setWinners] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [w, s] = await Promise.all([api.winners(), api.status()]);
        if (!alive) return;
        setWinners(w);
        setStatus(s);
        setUpdatedAt(new Date());
        setError('');
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const latest = winners[winners.length - 1];

  return (
    <div className="pg">
      <PageHeader
        title="Winners"
        subtitle="Official list of drawn names, in the order they were drawn. Updates live."
        right={updatedAt && <span className="pg-live"><span className="pg-live-dot" aria-hidden="true" />Live · updated {updatedAt.toLocaleTimeString()}</span>}
      />

      <section className="ld-stats" aria-label="Draw statistics">
        <div className="ld-stat"><span className="ld-stat-value">{status ? status.total : '—'}</span><span className="ld-stat-label">Participants</span></div>
        <div className="ld-stat accent"><span className="ld-stat-value">{status ? status.draws_done : '—'}</span><span className="ld-stat-label">Winners</span></div>
        <div className="ld-stat"><span className="ld-stat-value">{status ? status.remaining : '—'}</span><span className="ld-stat-label">Still in the pool</span></div>
      </section>

      {error && <p className="error">{error}</p>}

      {latest && (
        <section className="pg-spotlight" aria-label="Latest winner">
          <div className="pg-spotlight-kicker">Latest winner · No. {latest.draw_order}</div>
          <div className="pg-spotlight-name"><span aria-hidden="true">🏆</span> {latest.full_name}</div>
          <div className="pg-spotlight-meta">drawn {new Date(latest.drawn_at).toLocaleTimeString()}</div>
        </section>
      )}

      <section className="pg-panel">
        {winners.length === 0 ? (
          <p className="pg-empty">No winners yet — the list fills in as names are drawn.</p>
        ) : (
          <div className="table-wrap">
            <table className="pg-table">
              <thead>
                <tr><th className="col-no">No.</th><th>Name</th><th>Time drawn</th><th className="col-verify">Verify</th></tr>
              </thead>
              <tbody>
                {[...winners].reverse().map((w) => (
                  <tr key={w.draw_id} className={w.draw_id === latest?.draw_id ? 'latest' : ''}>
                    <td className="col-no"><span className="pg-no">{w.draw_order}</span></td>
                    <td className="name-cell">{w.full_name}</td>
                    <td className="muted">{new Date(w.drawn_at).toLocaleTimeString()}</td>
                    <td className="col-verify"><Link className="pg-link" to={`/audit/${w.draw_id}`}>audit record →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {status?.chain_head && winners.length > 0 && (
        <section className="pg-chain">
          <div className="pg-chain-label">Audit chain head</div>
          <code className="pg-chain-hash">{status.chain_head}</code>
          <p className="muted small">
            Changes with every draw; any alteration of a past result would change it. Note it down — anyone can
            recompute it on the <Link to="/audit">Audit / Verify</Link> page.
          </p>
        </section>
      )}
    </div>
  );
}
