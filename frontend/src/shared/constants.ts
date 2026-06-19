/**
 * CourtLink Pickleball — shared constants (single source of truth).
 *
 * Canonical contract shared by BOTH client and server. Copied verbatim into
 * `frontend/src/shared` and `backend/src/shared` (npm run sync:shared).
 *
 * COORDINATE SYSTEM (server-authoritative, in "court feet"):
 *   - Top-down. +x runs from Team A's baseline (x=0) to Team B's baseline
 *     (x=COURT_LENGTH). +y runs across the court. z is HEIGHT (0 = ground).
 *   - The net is the vertical plane at x = COURT_LENGTH / 2.
 *   - Team A always defends x < net; Team B always defends x > net.
 *   - IMPORTANT: this never changes. Each client ROTATES this world at render
 *     time so the local player's own side sits at the bottom of their screen.
 */

// --- Court geometry (real pickleball proportions: 44ft x 20ft) -------------
export const COURT_LENGTH = 44;
export const COURT_WIDTH = 20;
export const NET_X = COURT_LENGTH / 2; // 22
export const CENTER_Y = COURT_WIDTH / 2; // 10

export const KITCHEN_DEPTH = 7;
export const KITCHEN_A_MIN_X = NET_X - KITCHEN_DEPTH; // 15
export const KITCHEN_B_MAX_X = NET_X + KITCHEN_DEPTH; // 29

export const NET_HEIGHT = 2.83;

export const WORLD_MARGIN = 6;
export const WORLD_MIN_X = -WORLD_MARGIN;
export const WORLD_MAX_X = COURT_LENGTH + WORLD_MARGIN;
export const WORLD_MIN_Y = -WORLD_MARGIN;
export const WORLD_MAX_Y = COURT_WIDTH + WORLD_MARGIN;

// --- Physics ---------------------------------------------------------------
export const GRAVITY = 30; // ft/s^2 (tuned for readable arcs)
export const BALL_RADIUS = 0.18;
export const BOUNCE_RESTITUTION = 0.62;
export const AIR_DRAG = 0.0012; // gentle per-step horizontal damping (low: predictable arcs)
export const NET_CLEAR_MARGIN = 0.7; // how far above the tape a solved shot must pass

// --- Players / paddles -----------------------------------------------------
export const PADDLE_SPEED = 26; // ft/s (keyboard nudge speed; mouse is 1:1)
export const PADDLE_REACH = 3.0; // how close the ball must be to strike it (balanced)
export const HIT_MAX_HEIGHT = 5.0; // can't strike a ball higher than this

// Charge-based power. Holding fills from MIN to full over CHARGE_TIME_S.
export const CHARGE_TIME_S = 0.8;
export const SHOT_MIN_DIST = 13; // landing distance at min power
export const SHOT_MAX_DIST = 40; // landing distance at full power

// Air-hockey rally hits: contact + swipe velocity decides power & direction.
export const SWIPE_FULL_SPEED = 70; // cursor speed (ft/s) that maps to full power
export const HIT_COOLDOWN_S = 0.28; // min time between a player's contact hits
export const SERVER_HIT_REACH = 7.0; // generous server-side contact validation (lag tolerance)

// --- Networking / loop timing ---------------------------------------------
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 30;
export const INPUT_RATE = 30;
export const RENDER_DELAY_MS = 90;
export const RECONNECT_GRACE_MS = 30_000;

// --- Rules -----------------------------------------------------------------
export type ScoringMode = 'traditional' | 'rally';

export interface RuleConfig {
  mode: 'singles' | 'doubles';
  scoring: ScoringMode;
  pointsToWin: number;
  winBy: number;
  twoBounceRule: boolean;
  enforceKitchen: boolean;
  enforceDiagonalServe: boolean;
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
