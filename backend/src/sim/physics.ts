/**
 * Ball physics — pure, deterministic functions.
 *
 * The ball lives in 3D (x, y on the court plane; z = height) but is rendered
 * top-down with a shadow. Keeping z lets us model the two-bounce rule, net
 * clearance, and arcs honestly while still drawing a clean top-down court.
 *
 * These functions are intentionally side-effect free so the server tick is
 * easy to reason about and deterministic.
 */
import {
  AIR_DRAG,
  BALL_RADIUS,
  BOUNCE_RESTITUTION,
  COURT_LENGTH,
  COURT_WIDTH,
  GRAVITY,
  NET_HEIGHT,
  NET_X,
  WORLD_MAX_X,
  WORLD_MAX_Y,
  WORLD_MIN_X,
  WORLD_MIN_Y,
} from '../shared/constants';
import type { BallSnapshot, Side } from '../shared/types';

export interface BallState extends BallSnapshot {}

/** Result of advancing the ball one step — surfaces discrete collision facts. */
export interface StepResult {
  bounced: boolean; // hit the ground this step
  bounceSide: Side | null; // which half of the court it bounced on
  bounceInBounds: boolean; // was the bounce inside the legal court?
  crossedNet: boolean; // ball passed the net plane this step
  hitNet: boolean; // ball failed to clear the net
}

const sideForX = (x: number): Side => (x < NET_X ? 'A' : 'B');

const inBoundsXY = (x: number, y: number): boolean =>
  x >= -BALL_RADIUS &&
  x <= COURT_LENGTH + BALL_RADIUS &&
  y >= -BALL_RADIUS &&
  y <= COURT_WIDTH + BALL_RADIUS;

/**
 * Integrate the ball forward by dt seconds. Mutates and returns `ball`,
 * plus a StepResult describing anything discrete that happened.
 */
export function stepBall(ball: BallState, dt: number): StepResult {
  const result: StepResult = {
    bounced: false,
    bounceSide: null,
    bounceInBounds: false,
    crossedNet: false,
    hitNet: false,
  };

  const prevX = ball.x;

  // Gravity + gentle horizontal drag.
  ball.vz -= GRAVITY * dt;
  const drag = Math.max(0, 1 - AIR_DRAG);
  ball.vx *= drag;
  ball.vy *= drag;

  // Integrate position.
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;

  // --- Net plane crossing (x === NET_X) ---
  const crossed =
    (prevX < NET_X && ball.x >= NET_X) || (prevX > NET_X && ball.x <= NET_X);
  if (crossed) {
    result.crossedNet = true;
    // Did it clear the net? Approximate z at the crossing by linear interp.
    const t = (NET_X - prevX) / (ball.x - prevX || 1e-6);
    const zAtNet = ball.z - ball.vz * dt * (1 - t);
    if (zAtNet < NET_HEIGHT) {
      result.hitNet = true;
      // Kill forward momentum, drop the ball at the net.
      ball.x = NET_X + (prevX < NET_X ? -BALL_RADIUS : BALL_RADIUS);
      ball.vx *= -0.15;
      ball.vy *= 0.4;
    }
  }

  // --- Ground bounce (z <= 0) ---
  if (ball.z <= BALL_RADIUS && ball.vz < 0) {
    ball.z = BALL_RADIUS;
    ball.vz = -ball.vz * BOUNCE_RESTITUTION;
    ball.vx *= 0.86;
    ball.vy *= 0.86;
    result.bounced = true;
    result.bounceSide = sideForX(ball.x);
    result.bounceInBounds = inBoundsXY(ball.x, ball.y);
  }

  // --- Side / back walls of the WORLD (purely to stop runaway balls) ---
  if (ball.x < WORLD_MIN_X || ball.x > WORLD_MAX_X) ball.vx = 0;
  if (ball.y < WORLD_MIN_Y || ball.y > WORLD_MAX_Y) ball.vy = 0;
  ball.x = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, ball.x));
  ball.y = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y, ball.y));

  return result;
}

/** True if (x,y) sits inside the legal singles court rectangle. */
export function isInCourt(x: number, y: number): boolean {
  return inBoundsXY(x, y);
}

export { sideForX };
