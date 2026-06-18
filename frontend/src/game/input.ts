/**
 * Input controller — maps keyboard and touch into a normalized intent.
 *
 * The same shape (dirX, dirY, hit, serve, aimY) is produced regardless of
 * device, so the game loop and server treat desktop and mobile identically.
 * Touch controls (virtual joystick + buttons) write into `touch*` setters.
 */
export interface Intent {
  dirX: number;
  dirY: number;
  hit: boolean;
  serve: boolean;
  aimY: number;
}

const keys = new Set<string>();

// Touch state, written by the on-screen controls.
let touchDirX = 0;
let touchDirY = 0;
let touchHit = false;
let touchServe = false;

export function setTouchDir(x: number, y: number) {
  touchDirX = x;
  touchDirY = y;
}
export function setTouchHit(v: boolean) {
  touchHit = v;
}
export function setTouchServe(v: boolean) {
  touchServe = v;
}

function onKeyDown(e: KeyboardEvent) {
  keys.add(e.key.toLowerCase());
  // Prevent the page from scrolling when using arrows / space in-game.
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
    e.preventDefault();
  }
}
function onKeyUp(e: KeyboardEvent) {
  keys.delete(e.key.toLowerCase());
}

export function startInput() {
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
}
export function stopInput() {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  keys.clear();
}

/**
 * Read the current intent. `side` lets us keep controls intuitive: for both
 * players, Up/W moves toward the top sideline and Left/A moves toward Team A's
 * baseline — i.e. world axes, so it reads naturally on a top-down court.
 */
export function readIntent(): Intent {
  let dirX = 0;
  let dirY = 0;
  if (keys.has('a') || keys.has('arrowleft')) dirX -= 1;
  if (keys.has('d') || keys.has('arrowright')) dirX += 1;
  if (keys.has('w') || keys.has('arrowup')) dirY += 1; // +y = toward top sideline
  if (keys.has('s') || keys.has('arrowdown')) dirY -= 1;

  // Touch overrides/augments keyboard.
  if (touchDirX !== 0 || touchDirY !== 0) {
    dirX = touchDirX;
    dirY = touchDirY;
  }

  const hit = keys.has(' ') || keys.has('k') || touchHit;
  const serve = keys.has(' ') || keys.has('j') || touchServe;
  const aimY = dirY;

  return { dirX, dirY, hit, serve, aimY };
}
