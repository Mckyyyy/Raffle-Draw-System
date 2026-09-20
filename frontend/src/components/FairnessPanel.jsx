import { useEffect } from 'react';

const ShieldIcon = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" /><path d="m9 12 2 2 4-4" />
  </svg>
);
const CloseIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/**
 * Right-hand slide-out with everything the audience/auditor may want to see
 * without cluttering the Live Draw stage:
 *   - the server commitment for the NEXT draw (published before the button is pressed)
 *   - the chain head
 *   - the audit trail of the LAST draw (seeds, hashes, links to the full records)
 */
export default function FairnessPanel({ open, onToggle, commitment, chainHead, revealed, hasNew }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onToggle(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onToggle]);

  return (
    <>
      <button
        className={`fp-toggle ${open ? 'open' : ''} ${hasNew && !open ? 'has-new' : ''}`}
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-controls="fairness-panel"
        title="Fairness: server commitment & audit trail"
      >
        {ShieldIcon}
        <span className="fp-toggle-label">Fairness</span>
      </button>

      <div className={`fp-overlay ${open ? 'show' : ''}`} onClick={() => onToggle(false)} aria-hidden="true" />

      <aside id="fairness-panel" className={`fp ${open ? 'open' : ''}`} aria-label="Fairness and audit trail" aria-hidden={!open}>
        <header className="fp-head">
          <div>
            <div className="fp-kicker">Provably fair</div>
            <h2 className="fp-title">Fairness &amp; Audit</h2>
          </div>
          <button className="fp-close" onClick={() => onToggle(false)} aria-label="Close panel">{CloseIcon}</button>
        </header>

        <div className="fp-body">
          <section className="fp-section">
            <h3>Server commitment <span className="fp-sub">for the next draw</span></h3>
            {commitment ? (
              <>
                <code className="fp-hash">{commitment.server_seed_hash}</code>
                <p className="fp-note">
                  Published {new Date(commitment.created_at).toLocaleTimeString()}. The server fixed its secret seed
                  before the button is pressed; the seed is revealed in the draw record afterwards and must hash to this value.
                </p>
              </>
            ) : (
              <p className="fp-note">Enter the draw key on the Live Draw page to publish a commitment.</p>
            )}
          </section>

          <section className="fp-section">
            <h3>Chain head</h3>
            <code className="fp-hash">{chainHead || '—'}</code>
            <p className="fp-note">Verification hash of the latest draw. Every draw links to the one before it; altering any past result changes this value.</p>
          </section>

          <section className="fp-section">
            <h3>Audit trail <span className="fp-sub">{revealed.length ? `last draw · ${revealed.length} winner${revealed.length === 1 ? '' : 's'}` : 'no draw yet'}</span></h3>
            {revealed.length === 0 ? (
              <p className="fp-note">Details of each pick will appear here after a draw.</p>
            ) : revealed.map((d) => (
              <details key={d.draw_id} className="fp-entry">
                <summary><b>#{d.draw_order}</b> {d.winner.full_name} <a href={`/audit/${d.draw_id}`} onClick={(e) => e.stopPropagation()}>full record →</a></summary>
                <table className="kv fp-kv">
                  <tbody>
                    <tr><td>Pool size before this pick</td><td>{d.audit.pool_size}</td></tr>
                    <tr><td>Commitment (shown before)</td><td><code>{d.audit.server_seed_hash}</code></td></tr>
                    <tr><td>Server seed (revealed)</td><td><code>{d.audit.server_seed}</code></td></tr>
                    <tr><td>Client seed (browser nonce)</td><td><code>{d.audit.client_seed || '(none)'}</code></td></tr>
                    <tr><td>Previous hash</td><td><code>{d.audit.prev_hash}</code></td></tr>
                    <tr><td>Public beacon (drand)</td><td>{d.audit.beacon ? <>round {d.audit.beacon.round} · <code>{d.audit.beacon.randomness}</code></> : <span className="muted">none (offline)</span>}</td></tr>
                    <tr><td>Derived draw seed</td><td><code>{d.audit.draw_seed}</code></td></tr>
                    <tr><td>Random index</td><td>{d.audit.random_index}</td></tr>
                    <tr><td>Snapshot hash</td><td><code>{d.audit.snapshot_hash}</code></td></tr>
                    <tr><td>Verification hash</td><td><code>{d.audit.verification_hash}</code></td></tr>
                  </tbody>
                </table>
              </details>
            ))}
          </section>

          <p className="fp-note fp-foot">
            Each draw also mixes in the first <a href="https://drand.love" target="_blank" rel="noreferrer">drand</a> public
            randomness round published <em>after</em> the button is pressed — a value nobody in the room can know in advance.
            Anyone can recompute every value on the <a href="/audit">Audit / Verify</a> page — the browser does the math, not the server.
          </p>
        </div>
      </aside>
    </>
  );
}
