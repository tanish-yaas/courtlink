/**
 * TouchControls — mobile HOLD-TO-HIT (and serve) button.
 *
 * Movement is handled by the canvas itself (finger on court = paddle, 1:1), so
 * all this needs to provide is the charge trigger that mirrors the desktop left
 * mouse button: press and hold to charge power; while holding, drag your other
 * thumb on the court to aim; release to fire. It simply toggles the shared
 * `wantCharge` signal — the game loop does the timing + aim math.
 */
import { setWantCharge } from '../game/input';

export function TouchControls({ canServe }: { canServe: boolean }) {
  const press = (e: React.TouchEvent) => {
    e.preventDefault();
    setWantCharge(true);
  };
  const release = (e: React.TouchEvent) => {
    e.preventDefault();
    setWantCharge(false);
  };

  return (
    <div className="touch">
      <button
        className="touch__hit"
        onTouchStart={press}
        onTouchEnd={release}
        onTouchCancel={release}
      >
        <span className="touch__hit-label">{canServe ? 'SERVE' : 'HIT'}</span>
        <span className="touch__hit-sub">hold · drag to aim</span>
      </button>
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
