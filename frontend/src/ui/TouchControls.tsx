/**
 * TouchControls — mobile HOLD-TO-SERVE button.
 *
 * Rally hits on mobile are pure air-hockey: your finger drags the paddle on the
 * court and the swipe through the ball is the shot (handled by the canvas), so
 * no button is needed there. This button only appears on your serve: hold it to
 * charge power while your other thumb still positions the paddle, release to
 * serve. It just toggles the shared `wantCharge` signal.
 */
import { setWantCharge } from '../game/input';

export function TouchControls({ canServe }: { canServe: boolean }) {
  if (!canServe) return null;

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
        <span className="touch__hit-label">SERVE</span>
        <span className="touch__hit-sub">hold · still move · release</span>
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
