/**
 * CourtLink Pickleball — shared constants (single source of truth).
 *
 * This file is the canonical contract shared by BOTH client and server.
 * It is copied verbatim into `frontend/src/shared` and `backend/src/shared`
 * so each package is self-contained and can be deployed independently
 * (Vercel for the frontend, Render for the backend). Keep the copies in sync
 * with `npm run sync:shared` from the repo root.
 *
 * COORDINATE SYSTEM (all server-authoritative, in "court feet"):
 *   - The court is viewed top-down. +x runs from Team A's baseline (left)
 *     to Team B's baseline (right). +y runs across the court (sideline to
 *     sideline). z is HEIGHT above the court surface (0 = on the ground).
 *   - The net is the vertical plane at x = COURT_LENGTH / 2.
 *   - Team A always defends x < net. Team B always defends x > net.
 */

// ---------------------------------------------------------------------------
// Court geometry (real pickleball is 44ft x 20ft; we use those proportions)
// ---------------------------------------------------------------------------
export const COURT_LENGTH = 44; // baseline to baseline (x axis)
export const COURT_WIDTH = 20; // sideline to sideline (y axis)
export const NET_X = COURT_LENGTH / 2; // net plane at x = 22
export const CENTER_Y = COURT_WIDTH / 2; // center service line at y = 10

// Non-volley zone ("kitchen") extends 7ft from the net on each side.
export const KITCHEN_DEPTH = 7;
export const KITCHEN_A_MIN_X = NET_X - KITCHEN_DEPTH; // 15
export const KITCHEN_B_MAX_X = NET_X + KITCHEN_DEPTH; // 29

// Net rendering / physics height (real net is ~34in center; ~2.83ft).
export const NET_HEIGHT = 2.83;

// A little margin around the court so players/ball can travel slightly out.
export const WORLD_MARGIN = 6;
export const WORLD_MIN_X = -WORLD_MARGIN;
export const WORLD_MAX_X = COURT_LENGTH + WORLD_MARGIN;
export const WORLD_MIN_Y = -WORLD_MARGIN;
export const WORLD_MAX_Y = COURT_WIDTH + WORLD_MARGIN;

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------
export const GRAVITY = 30; // ft/s^2 (tuned for readable arcs, not realism)
export const BALL_RADIUS = 0.18;
export const BOUNCE_RESTITUTION = 0.62; // vertical energy kept per bounce
export const AIR_DRAG = 0.012; // gentle horizontal damping per step

// ---------------------------------------------------------------------------
// Players / paddles
// ---------------------------------------------------------------------------
export const PADDLE_SPEED = 16; // ft/s max movement
export const PADDLE_REACH = 2.6; // how close (x/y) the ball must be to hit
export const HIT_MAX_HEIGHT = 4.5; // can't hit a ball higher than this
export const HIT_POWER = 26; // base horizontal speed imparted on a hit
export const SERVE_POWER = 22; // base horizontal speed on a serve

// ---------------------------------------------------------------------------
// Networking / loop timing
// ---------------------------------------------------------------------------
export const TICK_RATE = 60; // server simulation steps per second
export const SNAPSHOT_RATE = 30; // state broadcasts per second
export const INPUT_RATE = 30; // client input sends per second
export const RENDER_DELAY_MS = 90; // client interpolation buffer
export const RECONNECT_GRACE_MS = 30_000; // keep a seat warm this long

// ---------------------------------------------------------------------------
// Rules configuration — everything tweakable lives here so the same engine
// can later support singles, doubles, or rally scoring without code changes.
// ---------------------------------------------------------------------------
export type ScoringMode = 'traditional' | 'rally';

export interface RuleConfig {
  mode: 'singles' | 'doubles'; // MVP ships singles; doubles is wired but not seated
  scoring: ScoringMode;
  pointsToWin: number; // games to 11 by default
  winBy: number; // win by 2
  twoBounceRule: boolean; // each side must let the ball bounce once before volleying
  enforceKitchen: boolean; // no volleys while standing in the non-volley zone
  enforceDiagonalServe: boolean; // serve must land in the diagonal service court
}

export const DEFAULT_RULES: RuleConfig = {
  mode: 'singles',
  scoring: 'traditional',
  pointsToWin: 11,
  winBy: 2,
  twoBounceRule: true,
  enforceKitchen: true,
  enforceDiagonalServe: true,
};

export const ROOM_CODE_LENGTH = 6;
