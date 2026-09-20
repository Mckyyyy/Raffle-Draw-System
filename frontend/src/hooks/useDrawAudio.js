import { useCallback, useEffect, useRef, useState } from 'react';
import fullUrl from '../assets/musicraffle.mp3';
import shortUrl from '../assets/musicraffle-short.mp3';

const STORAGE_KEY = 'draw_sound_muted';
const FULL = 0.9;   // volume during the shuffle

/**
 * Timelines of the draw music, measured from the waveforms.
 *
 * musicraffle.mp3 (12.7 s) is a slot-machine roll: a fast rattle, ticks that
 * slow down, a "stop" hit at 9.2 s, then a fanfare chord (10.2–10.7 s) and a
 * quiet tail. musicraffle-short.mp3 (6.15 s) is the same track with the middle
 * of the roll cut out (0–1.62 s spliced onto 6.85 s onward) so later names in a
 * batch don't take as long; its stop hit is at 3.95 s.
 *
 * The name shuffle is driven by these tables: before DECEL_FROM_S the names
 * roll continuously (the hits are too fast to tell apart), from DECEL_FROM_S on
 * every name change lands on an audible drum tick, and the winner lands exactly
 * on the stop hit.
 *
 * LOOP is a slice of the constant-speed rattle that can be repeated seamlessly.
 * When the pool is too big to show every name before DECEL_FROM_S, `startRound`
 * plays that slice extra times, so the roll lasts as long as the pool needs and
 * everything after it (ticks, stop hit, fanfare) simply shifts later.
 */
const RATTLE_STEP_S = 0.07;     // in the rattle the hits are too fast to hear individually
const rattle = (endS) => Array.from({ length: Math.floor(endS / RATTLE_STEP_S) }, (_, i) => +(0.08 + i * RATTLE_STEP_S).toFixed(3));
export const TRACKS = {
  full: {
    url: fullUrl,
    LOOP: { start: 1.55, end: 2.20 },   // repeatable rattle slice (0.65 s)
    DECEL_FROM_S: 5.5,           // from here the ticks are clearly separate hits (≥ 0.2 s apart)
    REVEAL_S: 9.2,               // winner is shown on this hit
    FANFARE_END_S: 10.7,         // final chord has finished by here
    END_S: 12.7,
    /** Every moment the displayed name should change, in seconds from round start. */
    TICKS_S: [
      ...rattle(2.2),
      2.27, 2.40, 2.52, 2.80, 2.87, 2.95, 3.02, 3.10, 3.27, 3.35, 3.45, 3.62, 3.72, 3.82, 3.92,
      4.15, 4.27, 4.37, 4.50, 4.77, 4.92, 5.07, 5.22, 5.37, 5.55, 5.75, 5.95, 6.15, 6.37, 6.62,
      6.87, 7.17, 7.45, 7.85, 8.25, 8.70,
    ],
  },
  short: {
    url: shortUrl,
    LOOP: { start: 0.95, end: 1.60 },
    DECEL_FROM_S: 1.6,
    REVEAL_S: 3.95,
    FANFARE_END_S: 5.45,
    END_S: 6.15,
    TICKS_S: [...rattle(1.6), 1.62, 1.92, 2.20, 2.60, 3.00, 3.45],
  },
};

/**
 * Draw music controller.
 *
 * Timing: every shuffle round plays the track once from the top. `startRound`
 * returns a clock (seconds since the round started) that is locked to the
 * audio's own position, so the animation follows the music rather than the
 * other way round — if the browser stalls the audio, the names stall with it.
 * When sound is muted or blocked the clock falls back to wall time, so the
 * draw looks identical either way.
 *
 * Autoplay policy: browsers only allow audio started from a user gesture.
 * `arm()` is called synchronously inside the Start Draw click and starts the
 * track at volume 0, which counts as the gesture; later round/fade calls only
 * control playback and volume. If the browser still refuses (NotAllowedError),
 * `blocked` becomes true and the page shows a hint; clicking the speaker button retries.
 */
export function useDrawAudio() {
  const audioRef = useRef({});     // one <audio> per track, keyed by TRACKS name
  const activeRef = useRef(null);  // the element currently in use
  const fadeRef = useRef(null);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; } });
  const [blocked, setBlocked] = useState(false);
  const [playing, setPlaying] = useState(false);

  const get = (kind = 'full') => {
    if (!audioRef.current[kind]) {
      const a = new Audio(TRACKS[kind].url);
      a.loop = false;
      a.preload = 'auto';
      a.volume = 0;
      a.addEventListener('ended', () => setPlaying(false));
      audioRef.current[kind] = a;
    }
    return audioRef.current[kind];
  };
  const all = () => Object.keys(TRACKS).map(get);

  const clearFade = () => { if (fadeRef.current) { clearInterval(fadeRef.current); fadeRef.current = null; } };

  /** Smoothly move volume to `target` over `ms`; optional callback when done. */
  const rampTo = useCallback((target, ms, done) => {
    const a = activeRef.current || get();
    clearFade();
    const from = a.volume;
    if (ms <= 0 || Math.abs(from - target) < 0.01) { a.volume = target; done?.(); return; }
    const t0 = performance.now();
    fadeRef.current = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const eased = k < 1 ? 1 - Math.pow(1 - k, 2) : 1;          // ease-out
      a.volume = Math.max(0, Math.min(1, from + (target - from) * eased));
      if (k >= 1) { clearFade(); done?.(); }
    }, 30);
  }, []);

  /**
   * Call synchronously inside the Start Draw click handler. Starts every track
   * silently from the top so each <audio> element is unlocked by the gesture.
   */
  const arm = useCallback(async () => {
    if (muted) return;
    try {
      for (const a of all()) {
        a.currentTime = 0;
        a.volume = 0;
        await a.play();
      }
      setBlocked(false);
      setPlaying(true);
    } catch (e) {
      // Autoplay refused (no user activation yet) — do not break the draw.
      if (e?.name === 'NotAllowedError') setBlocked(true);
    }
  }, [muted]);

  /** Rewind the silently armed track so visible music starts with the modal. */
  const resetForModal = useCallback(() => {
    clearFade();
    for (const a of all()) { a.pause(); a.currentTime = 0; a.volume = 0; }
    setPlaying(false);
  }, []);

  /**
   * Play the given track ('full' | 'short') from the top for one shuffle round,
   * with the rattle LOOP repeated `loops` extra times (see TRACKS).
   * Resolves to a clock: () => seconds on the round's timeline, i.e. the track's
   * own time plus whatever the loops inserted. While the audio is audibly playing
   * the clock is re-anchored to the audio position, so the shuffle can never
   * drift away from the music.
   */
  const startRound = useCallback(async (kind = 'full', loops = 0) => {
    const track = TRACKS[kind];
    const loopLen = track.LOOP.end - track.LOOP.start;
    let anchor = performance.now();
    const wallClock = () => (performance.now() - anchor) / 1000;
    if (muted) return wallClock;
    const a = get(kind);
    clearFade();
    for (const other of all()) if (other !== a) { other.pause(); other.currentTime = 0; }
    activeRef.current = a;
    try {
      a.pause();
      a.currentTime = 0;
      a.volume = 0;
      await a.play();
      anchor = performance.now() - a.currentTime * 1000;
      setBlocked(false);
      setPlaying(true);
    } catch (e) {
      if (e?.name === 'NotAllowedError') setBlocked(true);
      return wallClock;
    }
    rampTo(FULL, 120);              // the track has its own fade-in; this only hides the start click
    let loopsLeft = loops;
    let inserted = 0;               // seconds the loops have added to the timeline so far
    return () => {
      if (!a.paused && !a.ended) {
        if (loopsLeft > 0 && a.currentTime >= track.LOOP.end) {
          a.currentTime = track.LOOP.start;   // seamless: same steady rattle on both sides of the cut
          inserted += loopLen;
          loopsLeft--;
        }
        const drift = a.currentTime + inserted - wallClock();
        if (Math.abs(drift) > 0.05) anchor -= drift * 1000;   // snap the clock back onto the audio
      }
      return wallClock();
    };
  }, [muted, rampTo]);

  /** Immediate stop (errors, unmount). */
  const stop = useCallback(() => {
    clearFade();
    for (const a of Object.values(audioRef.current)) { a.pause(); a.currentTime = 0; a.volume = 0; }
    setPlaying(false);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      if (next) stop(); else setBlocked(false);
      return next;
    });
  }, [stop]);

  // Warm the cache so the first play starts instantly
  useEffect(() => { all().forEach((a) => a.load()); return () => stop(); }, [stop]);

  return { arm, resetForModal, startRound, stop, muted, toggleMuted, blocked, playing };
}
