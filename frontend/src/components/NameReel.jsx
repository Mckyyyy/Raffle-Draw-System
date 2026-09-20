import { useEffect, useRef } from 'react';

/**
 * Slot-machine reel of participant names: a column of names moving upward through a
 * marker rectangle in the centre.
 *
 * `reel` is a mutable ref object owned by LiveDraw: { rows: string[], pos: number }.
 * `rows` is the full list the reel travels through (every participant, ending on the
 * winner) and `pos` is the row currently in the centre window, as a float so the
 * reel can glide between rows. LiveDraw updates `pos` every animation frame; this
 * component applies it straight to the DOM (no React re-render per frame) so the
 * motion stays smooth even with hundreds of rows.
 */
export default function NameReel({ reel, rows, revealed = false }) {
  const trackRef = useRef(null);

  useEffect(() => {
    let raf = 0;
    let rowH = 0;
    // Row height = layout height of the whole track / rows. Layout (offsetHeight) ignores
    // transforms — the modal card scales in while this mounts, so getBoundingClientRect would
    // be too small — and dividing the whole track's height by the row count keeps the
    // per-row value fractional, so no rounding error accumulates over hundreds of rows.
    const measure = () => {
      const t = trackRef.current;
      rowH = t && rows.length ? t.offsetHeight / rows.length : 0;
    };
    // New round: drop any highlight left on a reused row element from the previous round
    if (trackRef.current) {
      for (const el of trackRef.current.children) el.classList.remove('is-centre');
      delete trackRef.current.dataset.centre;
    }
    const frame = () => {
      const track = trackRef.current;
      measure();                       // cheap (no layout is dirtied by the transform) and self-correcting on resize
      if (track && rowH) {
        const pos = reel.current.pos;
        track.style.transform = `translate3d(0, ${(-pos * rowH).toFixed(2)}px, 0)`;
        // Highlight the row nearest the centre line
        const centre = Math.round(pos);
        const prev = track.dataset.centre;
        if (prev !== String(centre)) {
          if (prev !== undefined) track.children[prev]?.classList.remove('is-centre');
          track.children[centre]?.classList.add('is-centre');
          track.dataset.centre = String(centre);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reel, rows]);

  return (
    <div className={`reel ${revealed ? 'revealed' : ''}`} aria-hidden="true">
      <div className="reel-window">
        <div className="reel-track" ref={trackRef}>
          {rows.map((name, i) => (
            <div className="reel-row" key={i}>{name}</div>
          ))}
        </div>
      </div>
      <div className="reel-marker" />
    </div>
  );
}
