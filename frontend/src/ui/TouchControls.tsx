/**
 * TouchControls — on-screen joystick + action buttons for mobile.
 *
 * Writes directly into the input layer's touch setters, producing the same
 * normalized intent the keyboard does, so the game loop is device-agnostic.
 * Rendered only when a coarse pointer (touch) is detected.
 */
import { useEffect, useRef } from 'react';
import { setTouchDir, setTouchHit, setTouchServe } from '../game/input';

export function TouchControls({ canServe }: { canServe: boolean }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const nubRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);

  useEffect(() => () => setTouchDir(0, 0), []);

  const updateNub = (dx: number, dy: number) => {
    if (nubRef.current) {
      nubRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  };

  const handle = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = r.width / 2;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    updateNub(dx, dy);
    // Screen +y is down; world +y is up, so invert the vertical axis.
    setTouchDir(dx / max, -(dy / max));
  };

  const onStart = (e: React.TouchEvent) => {
    active.current = true;
    const t = e.touches[0];
    handle(t.clientX, t.clientY);
  };
  const onMove = (e: React.TouchEvent) => {
    if (!active.current) return;
    const t = e.touches[0];
    handle(t.clientX, t.clientY);
  };
  const onEnd = () => {
    active.current = false;
    setTouchDir(0, 0);
    updateNub(0, 0);
  };

  return (
    <div className="touch">
      <div
        className="joystick"
        ref={baseRef}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
        onTouchCancel={onEnd}
      >
        <div className="joystick__nub" ref={nubRef} />
      </div>

      <div className="touch__actions">
        {canServe && (
          <button
            className="touch__btn"
            onTouchStart={() => setTouchServe(true)}
            onTouchEnd={() => setTouchServe(false)}
          >
            Serve
          </button>
        )}
        <button
          className="touch__btn"
          onTouchStart={() => setTouchHit(true)}
          onTouchEnd={() => setTouchHit(false)}
        >
          Hit
        </button>
      </div>
    </div>
  );
}

/** Detect a touch-first device so we only mount controls where they make sense. */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || navigator.maxTouchPoints > 0) &&
    window.matchMedia('(pointer: coarse)').matches
  );
}
