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
export default function NameReel({ reel, rows }) {
  const trackRef = useRef(null);
  const rowRef = useRef(null);

  useEffect(() => {
    let raf = 0;
    let rowH = 0;
    const measure = () => { rowH = rowRef.current?.offsetHeight || 0; };
    measure();
    window.addEventListener('resize', measure);
    const frame = () => {
      const track = trackRef.current;
      if (!rowH) measure();
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
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [reel, rows]);

  return (
    <div className="reel" aria-hidden="true">
      <div className="reel-window">
        <div className="reel-track" ref={trackRef}>
          {rows.map((name, i) => (
            <div className="reel-row" key={i} ref={i === 0 ? rowRef : undefined}>{name}</div>
          ))}
        </div>
      </div>
      <div className="reel-marker" />
    </div>
  );
}
