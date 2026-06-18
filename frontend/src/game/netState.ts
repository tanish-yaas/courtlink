/**
 * Client-side net state: snapshot buffer + interpolation.
 *
 * The server is authoritative and sends snapshots ~30/s. To render smoothly we
 * buffer snapshots and draw the world slightly in the past (RENDER_DELAY_MS),
 * interpolating between the two snapshots that bracket "render time". This is
 * the standard approach that hides jitter without inventing positions.
 *
 * The local player's own paddle is PREDICTED separately (see game loop) so it
 * feels instant; everything else is interpolated from the authoritative feed.
 */
import { RENDER_DELAY_MS } from '../shared/constants';
import type { GameSnapshot, ScoreState, Side } from '../shared/types';

const MAX_BUFFER = 24;
const buffer: GameSnapshot[] = [];
let clockOffset = 0; // serverTime - clientTime (ms), smoothed

export function pushSnapshot(snap: GameSnapshot) {
  // Estimate clock offset so we can place snapshots on our own clock.
  const sample = snap.serverTimeMs - performance.timeOrigin - performance.now();
  clockOffset = clockOffset === 0 ? sample : clockOffset * 0.9 + sample * 0.1;

  buffer.push(snap);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}

export interface RenderState {
  ball: { x: number; y: number; z: number };
  paddles: Record<Side, { x: number; y: number }>;
  score: ScoreState | null;
  phase: GameSnapshot['phase'] | null;
  countdown?: number;
  ack: Record<string, number>;
}

function nowServerMs(): number {
  return performance.timeOrigin + performance.now() + clockOffset;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function getRenderState(): RenderState | null {
  if (buffer.length === 0) return null;
  const renderTime = nowServerMs() - RENDER_DELAY_MS;

  // Find the two snapshots bracketing renderTime.
  let older = buffer[0];
  let newer = buffer[buffer.length - 1];
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i].serverTimeMs <= renderTime && buffer[i + 1].serverTimeMs >= renderTime) {
      older = buffer[i];
      newer = buffer[i + 1];
      break;
    }
  }

  const span = newer.serverTimeMs - older.serverTimeMs || 1;
  const t = Math.max(0, Math.min(1, (renderTime - older.serverTimeMs) / span));

  const padOlder = toMap(older);
  const padNewer = toMap(newer);

  return {
    ball: {
      x: lerp(older.ball.x, newer.ball.x, t),
      y: lerp(older.ball.y, newer.ball.y, t),
      z: lerp(older.ball.z, newer.ball.z, t),
    },
    paddles: {
      A: {
        x: lerp(padOlder.A?.x ?? 0, padNewer.A?.x ?? 0, t),
        y: lerp(padOlder.A?.y ?? 0, padNewer.A?.y ?? 0, t),
      },
      B: {
        x: lerp(padOlder.B?.x ?? 0, padNewer.B?.x ?? 0, t),
        y: lerp(padOlder.B?.y ?? 0, padNewer.B?.y ?? 0, t),
      },
    },
    score: newer.score,
    phase: newer.phase,
    countdown: newer.countdown,
    ack: newer.ack,
  };
}

/** Latest authoritative position of a side's paddle (for prediction reconcile). */
export function latestPaddle(side: Side): { x: number; y: number } | null {
  const last = buffer[buffer.length - 1];
  if (!last) return null;
  const p = last.paddles.find((q) => q.side === side);
  return p ? { x: p.x, y: p.y } : null;
}

export function clearBuffer() {
  buffer.length = 0;
  clockOffset = 0;
}

function toMap(s: GameSnapshot): Partial<Record<Side, { x: number; y: number }>> {
  const m: Partial<Record<Side, { x: number; y: number }>> = {};
  for (const p of s.paddles) m[p.side] = { x: p.x, y: p.y };
  return m;
}
