import { useEffect, useMemo } from 'react';
import lguLogo from '../assets/LGU_LOGO.png';
import NameReel from './NameReel.jsx';
import { LGU_NAME } from './Brand.jsx';

const CONFETTI_COLORS = ['#f59e0b', '#fbbf24', '#fde68a', '#ffffff', '#38bdf8', '#22c55e', '#f472b6'];

function Confetti({ burst }) {
  // Regenerated on every `burst` change so each reveal gets a fresh shower
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    id: `${burst}-${i}`,
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    duration: 2.6 + Math.random() * 1.6,
    size: 6 + Math.random() * 8,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 160,
    round: Math.random() > 0.6,
  })), [burst]);
  if (!burst) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className={`confetti-piece ${p.round ? 'round' : ''}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            '--rot': `${p.rotate}deg`,
            '--drift': `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Formal winner announcement.
 *  phase:    'shuffling' | 'revealed'
 *  display:  name currently shown while shuffling (fallback / screen readers)
 *  reel:     mutable ref { rows, pos } driven by LiveDraw — the spinning reel of every name
 *  reelRows: the reel's rows (state, so the reel re-renders when a new round starts)
 *  current:  the draw being revealed
 *  revealed: draws revealed so far in this batch
 *  total:    how many names are in this batch
 *  done:     true when every name in the batch has been revealed → final result view
 *
 * Only the winner's name is ever shown here — no entry code, time, or hashes.
 */
export default function WinnerModal({ open, phase, display, reel, reelRows, current, revealed, total, done, burst, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape' && done) onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [open, done, onClose]);

  // Stamp the final view with the moment the batch finished (client clock; the audit page has the server times)
  const finishedAt = useMemo(() => (done ? new Date() : null), [done]);

  if (!open || !current) return null;

  const isRevealed = revealed.some((r) => r.draw_id === current.draw_id);
  const stamp = finishedAt?.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="wm-overlay" role="dialog" aria-modal="true" aria-label="Raffle winner announcement">
      <Confetti burst={burst} />
      <div className={`wm-card ${isRevealed ? 'revealed' : 'shuffling'} ${done ? 'done' : ''}`}>
        <div className="wm-rays" aria-hidden="true" />
        {done && (
          <div className="wm-sparkles" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ '--i': i }} />)}
          </div>
        )}
        <div className="wm-corner tl" aria-hidden="true" /><div className="wm-corner tr" aria-hidden="true" />
        <div className="wm-corner bl" aria-hidden="true" /><div className="wm-corner br" aria-hidden="true" />

        <div className="wm-body">
        <header className="wm-head">
          <img src={lguLogo} alt="Municipality of General Luna Logo" className="wm-seal" />
          <div className="wm-lgu">{LGU_NAME}</div>
          {!done && (
            <div className="wm-kicker">
              {isRevealed ? 'Official Raffle Winner' : 'Drawing Winner'}
              {total > 1 && <span className="wm-progress"> · {Math.min(revealed.length + (isRevealed ? 0 : 1), total)} of {total}</span>}
            </div>
          )}
        </header>

        {done ? (
          <div className="wm-final">
            <div className="wm-congrats">Congratulations</div>
            <div className="wm-final-title" role="heading" aria-level={2}>
              <span className="wm-star" aria-hidden="true">✦</span>
              {total > 1 ? 'Winners' : 'Winner'}
              <span className="wm-star" aria-hidden="true">✦</span>
            </div>
            <div className="wm-final-sub">
              {total > 1 ? `${total} names drawn` : 'Official raffle result'}{stamp ? ` · ${stamp}` : ''}
            </div>
          </div>
        ) : (
          <div className="wm-order">Winner No. {current.draw_order}</div>
        )}

        {!done && (
          <div className="wm-name-wrap">
            {reelRows?.length ? (
              <>
                {/* The reel stays through the reveal: the winner lands in the rectangle and turns gold there */}
                <NameReel reel={reel} rows={reelRows} revealed={isRevealed} />
                <span className="sr-only" aria-live={isRevealed ? 'polite' : 'off'}>{display}</span>
              </>
            ) : (
              <div className="wm-name" key={isRevealed ? `r-${current.draw_id}` : 'shuffling'}>
                {display}
              </div>
            )}
            <div className="wm-rule" />
          </div>
        )}

        {/* In-progress list for batches, and the final result (1 large card, or a 2-column grid) */}
        {(done || (total > 1 && revealed.length > 0)) && (
          <div className={`wm-batch ${done ? 'final' : ''} ${done && total === 1 ? 'single' : ''}`}>
            {!done && <div className="wm-batch-title">Drawn so far</div>}
            <ol className="wm-batch-list" aria-label={done ? `${total} winner${total === 1 ? '' : 's'}` : 'Winners drawn so far'}>
              {revealed.map((d, i) => (
                <li
                  key={d.draw_id}
                  className={`wm-winner-row ${done ? 'highlight' : d.draw_id === current.draw_id ? 'latest' : ''}`}
                  style={{ '--i': i }}
                >
                  <span className="wm-trophy" aria-hidden="true">🏆</span>
                  <span className="wm-batch-name">{d.winner.full_name}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        </div>

        <footer className="wm-foot">
          {done ? (
            <button className="btn-primary wm-close" onClick={onClose} autoFocus>Close</button>
          ) : (
            <div className="wm-wait">{phase === 'shuffling' && !isRevealed ? 'Selecting…' : 'Next winner…'}</div>
          )}
          <div className="wm-note">Result generated by the server before this animation · verifiable on the Audit page</div>
        </footer>
      </div>
    </div>
  );
}
