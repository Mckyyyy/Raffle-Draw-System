import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { LGU_NAME } from '../components/Brand.jsx';
import WinnerModal from '../components/WinnerModal.jsx';
import FairnessPanel from '../components/FairnessPanel.jsx';
import { useDrawAudio, TRACKS } from '../hooks/useDrawAudio.js';
import { browserNonce } from '../verify.js';
import lguLogo from '../assets/LGU_LOGO.png';

// Every name is drawn to one play of a music track: the reel of names spins up through the
// fast roll, steps on the drum hits and the winner lands on the "stop" hit (see TRACKS in
// useDrawAudio.js). The first name of a batch gets the full roll; later names use the shorter
// cut. Either way EVERY name in the pool passes through the reel: if the pool is too big for
// the roll, the track's rattle is looped for as long as it takes (`loopsFor`) and the rest of
// the track shifts later.
const REEL_MAX_ROWS_PER_S = 60;   // faster than this the names are an unreadable blur
const REEL_MIN_ROWS_PER_S = 25;   // slower than this the roll looks lazy (small pools cycle several times)
const REEL_SPINUP_S = 0.4;        // the reel accelerates over this long at the start
const fastEndOf = (track) => track.TICKS_S.find((t) => t >= track.DECEL_FROM_S) ?? track.REVEAL_S;
const trackFor = (idx) => (idx === 0 ? 'full' : 'short');
const loopsFor = (track, poolSize) => {
  const need = poolSize / REEL_MAX_ROWS_PER_S + REEL_SPINUP_S / 2 - fastEndOf(track);   // seconds the roll is short by
  return need > 0 ? Math.ceil(need / (track.LOOP.end - track.LOOP.start)) : 0;
};
const pauseAfter = (kind) => Math.round((TRACKS[kind].FANFARE_END_S - TRACKS[kind].REVEAL_S) * 1000) + 200; // let the fanfare finish
const PAUSE_LAST_MS = 2600;      // the final name gets a longer highlighted moment before the summary appears

const STATUS_TEXT = {
  idle: 'Ready to draw',
  requesting: 'Contacting server',
  shuffling: 'Drawing in progress',
  revealed: 'Winner announced',
};

export default function LiveDraw() {
  const [status, setStatus] = useState(null);
  const [pool, setPool] = useState([]);
  const [drawKey, setDrawKey] = useState(() => sessionStorage.getItem('draw_key') || '');
  const [count, setCount] = useState(1);
  const [phase, setPhase] = useState('idle'); // idle | requesting | shuffling | revealed
  const [display, setDisplay] = useState('');
  const [current, setCurrent] = useState(null);   // the draw currently being revealed
  const [revealed, setRevealed] = useState([]);   // draws revealed so far in this batch
  const [batchTotal, setBatchTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [burst, setBurst] = useState(0);          // increments on every reveal → new confetti shower
  const [error, setError] = useState('');
  const [commitment, setCommitment] = useState(null); // { commit_id, server_seed_hash, created_at } shown BEFORE the draw
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelNew, setPanelNew] = useState(false);   // dot on the toggle after a draw finishes
  const timerRef = useRef(null);
  const rafRef = useRef(null);
  const reelRef = useRef({ rows: [], pos: 0 });   // shared with <NameReel>, mutated per frame
  const [reelRows, setReelRows] = useState([]);
  const aliveRef = useRef(true);
  const audio = useDrawAudio();

  const refresh = async () => {
    try {
      const [s, p] = await Promise.all([api.status(), api.participants()]);
      setStatus(s);
      setPool(p);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; clearTimeout(timerRef.current); cancelAnimationFrame(rafRef.current); };
  }, []);
  useEffect(() => { sessionStorage.setItem('draw_key', drawKey); }, [drawKey]);

  // Fairness step C1–C2: as soon as a draw key is present, ask the server to COMMIT to a secret seed
  // and show its hash on screen. The server can no longer change that seed after this point.
  const loadCommitment = useCallback(async (key) => {
    if (!key) { setCommitment(null); return; }
    try { setCommitment(await api.commit(key)); } catch { setCommitment(null); }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => loadCommitment(drawKey), 400);
    return () => clearTimeout(t);
  }, [drawKey, loadCommitment]);

  const maxCount = Math.max(1, Math.min(status?.max_count ?? 10, status?.remaining ?? 10));
  useEffect(() => { if (count > maxCount) setCount(maxCount); }, [maxCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = phase === 'requesting' || phase === 'shuffling';

  // Visual shuffle only — the winner is already decided by the backend and is passed in as finalName.
  //
  // The reel travels through EVERY name in the pool (a fresh random permutation each round,
  // repeated for small pools so the roll never looks lazy) and ends on the winner:
  //   rows = [ ...fast-roll names | ...one name per audible drum tick | winner ]
  // Position is a function of `clock()` — the round clock from the audio hook, locked to the
  // track's playback position — so the reel can never drift from the music. `extraS` is how
  // much the rattle loops added before the slow-down; everything after it shifts by that.
  //   1. Fast roll  [0, fastEnd): spins up over REEL_SPINUP_S, then constant speed, chosen so
  //      that all the fast-roll rows have passed the centre line exactly when the roll ends.
  //   2. Slow-down  [fastEnd, revealAt): one row per drum tick — the track's own deceleration.
  //   3. revealAt: the winner is in the centre rectangle; the modal switches to the reveal.
  const shuffle = (names, finalName, track, clock, extraS = 0) => new Promise((resolve) => {
    const permute = (arr) => {
      const out = [...arr];
      for (let k = out.length - 1; k > 0; k--) {           // Fisher–Yates, display order only
        const j = Math.floor(Math.random() * (k + 1));
        [out[k], out[j]] = [out[j], out[k]];
      }
      return out;
    };
    const decelTicks = track.TICKS_S.filter((t) => t >= track.DECEL_FROM_S).map((t) => t + extraS);
    const revealAt = track.REVEAL_S + extraS;
    const fastEnd = decelTicks[0] ?? revealAt;

    // One permutation walked in order across both phases, repeated for small pools; the
    // winner is skipped in the slow-down rows so it is seen only once — on the stop hit.
    const minFast = Math.ceil(REEL_MIN_ROWS_PER_S * fastEnd);
    let bag = permute(names);
    const take = (skipWinner) => {
      for (;;) {
        if (!bag.length) bag = permute(names);
        const n = bag.shift();
        if (!skipWinner || n !== finalName || names.length === 1) return n;
      }
    };
    const fastRows = [];
    while (fastRows.length < Math.max(names.length, minFast)) fastRows.push(take(false));
    const decelRows = decelTicks.map(() => take(true));
    const rows = [...fastRows, ...decelRows, finalName];
    const nFast = fastRows.length;
    reelRef.current = { rows, pos: 0 };
    setReelRows(rows);

    // Position curve. Fast roll: velocity ramps 0 → V over REEL_SPINUP_S then holds, and must
    // cover (nFast - 1) rows by fastEnd.  Slow-down: at each tick slide one row (ease-out).
    const t0 = Math.min(REEL_SPINUP_S, fastEnd / 2);
    const V = (nFast - 1) / (fastEnd - t0 / 2);
    const fastPos = (t) => (t < t0 ? (V * t * t) / (2 * t0) : V * (t - t0 / 2));
    const easeOut = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
    const stops = [...decelTicks, revealAt];
    const posAt = (t) => {
      if (t < fastEnd) return fastPos(t);
      let k = 0;
      while (k + 1 < stops.length && stops[k + 1] <= t) k++;
      const gap = (stops[k + 1] ?? stops[k] + 0.3) - stops[k];
      const slide = Math.min(0.18, gap * 0.55);
      return nFast - 1 + k + easeOut((t - stops[k]) / slide);
    };

    let lastShown = -1;
    let lastShownAt = 0;
    const frame = () => {
      if (!aliveRef.current) return;
      const t = clock();
      if (t >= revealAt) {
        reelRef.current.pos = rows.length - 1;
        setDisplay(finalName);
        resolve();
        return;
      }
      const pos = Math.min(rows.length - 2, posAt(t));
      reelRef.current.pos = pos;
      // The stage behind the modal mirrors the centre name (throttled — it is not the main display)
      const centre = Math.round(pos);
      if (centre !== lastShown && (t - lastShownAt > 0.08 || t >= fastEnd)) {
        lastShown = centre; lastShownAt = t; setDisplay(rows[centre]);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    frame();
  });
  const sleep = (ms) => new Promise((r) => { timerRef.current = setTimeout(r, ms); });

  async function startDraw() {
    if (busy) return; // guard against double-click
    audio.arm();      // must happen inside the click handler for browser autoplay rules
    setError('');
    setRevealed([]);
    setCurrent(null);
    setBatchTotal(count);
    setPhase('requesting');
    let res;
    try {
      // ALL winners come from the backend in one transaction BEFORE any animation.
      // client_seed = a fresh browser nonce chosen AFTER the server committed, so
      // neither the server nor this browser can steer the result alone.
      const clientSeed = `#${browserNonce()}`;
      res = await api.draw(drawKey, count, { commit_id: commitment?.commit_id ?? null, client_seed: clientSeed });
    } catch (e) {
      audio.stop();
      setError(e.message);
      setPhase('idle');
      return;
    }
    setBatchTotal(res.draws.length);
    audio.resetForModal();                       // remove request latency from the music timeline
    setPhase('shuffling');
    setModalOpen(true);
    let names = pool.map((p) => p.full_name);
    const done = [];
    for (const [idx, d] of res.draws.entries()) {
      if (!aliveRef.current) return;
      setCurrent(d);
      if (names.length === 0) names = [d.winner.full_name];
      const kind = trackFor(idx);
      const loops = loopsFor(TRACKS[kind], names.length);   // 0 unless the pool needs a longer roll
      const clock = await audio.startRound(kind, loops);    // track restarts from the top for every name
      await shuffle(names, d.winner.full_name, TRACKS[kind], clock, loops * (TRACKS[kind].LOOP.end - TRACKS[kind].LOOP.start));
      done.push(d);
      setRevealed([...done]);
      setBurst((b) => b + 1);
      // The music keeps playing: its fanfare chord sounds during the pause below.
      names = names.filter((n) => n !== d.winner.full_name); // drawn name leaves the visual pool too
      // Every name — including the last one — is shown highlighted before we move on.
      await sleep(idx < res.draws.length - 1 ? pauseAfter(kind) : (res.draws.length > 1 ? PAUSE_LAST_MS : pauseAfter(kind)));
      if (!aliveRef.current) return;
    }
    setPhase('revealed');
    setPanelNew(true);
    refresh();
    loadCommitment(drawKey); // fresh commitment for the next draw
  }

  const closeModal = useCallback(() => setModalOpen(false), []);
  const hasResult = phase === 'revealed' && revealed.length > 0;
  const remaining = status?.remaining ?? 0;
  const poolEmpty = !!status && remaining === 0;

  return (
    <div className="ld">
      {/* ---------- Hero ---------- */}
      <header className="ld-hero">
        <img src={lguLogo} alt="Municipality of General Luna Logo" className="ld-seal" />
        <div className="ld-lgu">{LGU_NAME}</div>
        <h1 className="ld-title">Live Raffle Draw</h1>
        <div className="ld-title-rule" aria-hidden="true" />
      </header>

      {/* ---------- Stats ---------- */}
      <section className="ld-stats" aria-label="Draw statistics">
        <div className="ld-stat"><span className="ld-stat-value">{status ? status.total : '—'}</span><span className="ld-stat-label">Participants</span></div>
        <div className="ld-stat accent"><span className="ld-stat-value">{status ? status.remaining : '—'}</span><span className="ld-stat-label">In the pool</span></div>
        <div className="ld-stat"><span className="ld-stat-value">{status ? status.draws_done : '—'}</span><span className="ld-stat-label">Drawn</span></div>
      </section>

      <WinnerModal
        open={modalOpen}
        phase={phase}
        display={display}
        reel={reelRef}
        reelRows={reelRows}
        current={current}
        revealed={revealed}
        total={batchTotal}
        done={phase === 'revealed'}
        burst={burst}
        onClose={closeModal}
      />

      {/* ---------- Stage ---------- */}
      <section className={`ld-stage ${phase} ${hasResult ? 'has-result' : ''}`} aria-live="polite">
        <div className="ld-stage-glow" aria-hidden="true" />
        <div className="ld-status">
          <span className="ld-status-dot" aria-hidden="true" />
          {STATUS_TEXT[phase]}
          {phase === 'shuffling' && batchTotal > 1 && (
            <span className="ld-status-sub"> · {Math.min(revealed.length + 1, batchTotal)} of {batchTotal}</span>
          )}
        </div>

        {phase === 'idle' && !hasResult && (
          <div className="ld-idle">
            <div className="ld-ring" aria-hidden="true"><span /></div>
            <div className="ld-idle-text">{poolEmpty ? 'No participants left in the pool' : 'Press Start Draw to begin'}</div>
          </div>
        )}

        {phase === 'requesting' && (
          <div className="ld-idle">
            <div className="ld-ring spinning" aria-hidden="true"><span /></div>
            <div className="ld-idle-text">Securing the result…</div>
          </div>
        )}

        {phase === 'shuffling' && (
          <div className="ld-drawing">
            <div className="ld-drawing-name">{display}</div>
            <div className="ld-scanline" aria-hidden="true" />
          </div>
        )}

        {hasResult && (
          <div className="ld-result">
            <div className="ld-result-title"><span aria-hidden="true">🎉</span> WINNER <span aria-hidden="true">🎉</span></div>
            <ol className={`winner-cards ${revealed.length === 1 ? 'single' : ''}`} aria-label={`${revealed.length} winner${revealed.length === 1 ? '' : 's'}`}>
              {revealed.map((d, i) => (
                <li key={d.draw_id} className="winner-card" style={{ '--i': i }}>
                  <span className="winner-card-trophy" aria-hidden="true">🏆</span>
                  <span className="winner-card-name">{d.winner.full_name}</span>
                </li>
              ))}
            </ol>
            {!modalOpen && (
              <button className="ld-replay" onClick={() => setModalOpen(true)}>Show announcement again</button>
            )}
          </div>
        )}
      </section>

      {/* ---------- Controls ---------- */}
      <section className="ld-controls" aria-label="Draw controls">
        <label className="ld-field">
          <span>Draw key</span>
          <input
            type="password"
            placeholder="Enter draw key"
            value={drawKey}
            onChange={(e) => setDrawKey(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <label className="ld-field ld-field-count">
          <span>Number of winners</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy || !status || poolEmpty}>
            {Array.from({ length: maxCount }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          className="ld-start"
          onClick={startDraw}
          disabled={busy || !drawKey || poolEmpty}
        >
          {busy ? 'Drawing…' : count > 1 ? `Draw ${count} Winners` : 'Start Draw'}
        </button>
        <button
          type="button"
          className={`ld-sound ${audio.muted ? 'muted' : ''} ${audio.playing ? 'playing' : ''}`}
          onClick={audio.toggleMuted}
          aria-pressed={!audio.muted}
          title={audio.muted ? 'Sound off — click to enable draw music' : 'Sound on — click to mute'}
        >
          <span aria-hidden="true">{audio.muted ? '🔇' : '🔊'}</span>
          <span className="ld-sound-label">{audio.muted ? 'Sound off' : 'Sound on'}</span>
        </button>
      </section>
      {audio.blocked && !audio.muted && (
        <p className="ld-hint">The browser blocked audio until you interact with the page — click anywhere, then start the draw again.</p>
      )}
      {error && <p className="ld-error" role="alert">{error}</p>}

      <FairnessPanel
        open={panelOpen}
        onToggle={(v) => { setPanelOpen(v); if (v) setPanelNew(false); }}
        commitment={commitment}
        chainHead={status?.chain_head}
        revealed={hasResult ? revealed : []}
        hasNew={panelNew}
      />
    </div>
  );
}
