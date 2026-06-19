/**
 * AIController — a computer opponent that actually plays pickleball.
 *
 * It reads the authoritative local sim each tick and produces an InputReq for
 * its side: it tracks/anticipates the ball, moves to intercept (speed-capped),
 * respects the two-bounce rule (it waits for the bounce instead of illegally
 * volleying), then swings — aiming away from you and choosing depth by power.
 * Difficulty scales reaction lag, foot speed, accuracy, power and the odd miss.
 */
import {
  BALL_RADIUS,
  CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  HIT_MAX_HEIGHT,
  NET_X,
} from '../shared/constants';
import type { InputReq, Side } from '../shared/types';
import type { GameSim } from '../sim/GameSim';

export type Difficulty = 'easy' | 'medium' | 'hard';

interface Params {
  speed: number; // foot speed (ft/s)
  react: number; // re-aim interval (s) — higher = slower reactions
  aimNoise: number; // lateral aim randomness (0..1 of half-width)
  powMin: number;
  powMax: number;
  miss: number; // chance to fluff an otherwise-makeable ball
  reach: number; // how close (ft) it chooses to strike
}

const TUNING: Record<Difficulty, Params> = {
  easy: { speed: 12, react: 0.34, aimNoise: 0.55, powMin: 0.3, powMax: 0.55, miss: 0.2, reach: 2.4 },
  medium: { speed: 19, react: 0.16, aimNoise: 0.28, powMin: 0.45, powMax: 0.82, miss: 0.06, reach: 2.7 },
  hard: { speed: 29, react: 0.06, aimNoise: 0.08, powMin: 0.62, powMax: 1.0, miss: 0.0, reach: 3.0 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class AIController {
  private seq = 0;
  private swingId = 0;
  private aimX: number;
  private aimY = 0;
  private power = 0;
  private cur: { x: number; y: number };
  private reactTimer = 0;
  private desired: { x: number; y: number };
  private serveTimer = 0;
  private p: Params;

  constructor(public side: Side, public difficulty: Difficulty) {
    this.p = TUNING[difficulty];
    const x = side === 'A' ? COURT_LENGTH * 0.16 : COURT_LENGTH * 0.84;
    this.cur = { x, y: CENTER_Y };
    this.desired = { x, y: CENTER_Y };
    this.aimX = side === 'A' ? 1 : -1;
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    this.p = TUNING[d];
  }

  /** Produce this tick's input for the AI side. */
  update(sim: GameSim, dt: number): InputReq {
    const ball = sim.ball;
    const opp: Side = this.side === 'A' ? 'B' : 'A';
    const me = sim.paddles[this.side];
    const homeX = this.side === 'A' ? NET_X - 9 : NET_X + 9;

    // Is the ball our responsibility (on our side or heading to us)?
    const heading = this.side === 'A' ? ball.vx < 0 : ball.vx > 0;
    const onMyHalf = this.side === 'A' ? ball.x < NET_X : ball.x > NET_X;
    const mine = onMyHalf || heading;

    // Re-aim our desired spot on a reaction cadence (slower = laggier AI).
    this.reactTimer -= dt;
    if (this.reactTimer <= 0) {
      this.reactTimer = this.p.react;
      if (mine) {
        // Anticipate where the ball will be using its velocity.
        const lead = Math.min(0.35, this.p.react + 0.05);
        const px = ball.x + ball.vx * lead;
        const py = ball.y + ball.vy * lead;
        const xMin = this.side === 'A' ? 1 : NET_X + 1.2;
        const xMax = this.side === 'A' ? NET_X - 1.2 : COURT_LENGTH - 1;
        this.desired = { x: clamp(px, xMin, xMax), y: clamp(py, 1, COURT_WIDTH - 1) };
      } else {
        // Recover toward a ready position.
        this.desired = { x: homeX, y: CENTER_Y + (ball.y - CENTER_Y) * 0.3 };
      }
    }

    // Move toward desired, capped at foot speed.
    const dx = this.desired.x - this.cur.x;
    const dy = this.desired.y - this.cur.y;
    const d = Math.hypot(dx, dy);
    const step = this.p.speed * dt;
    if (d <= step || d < 1e-4) {
      this.cur = { ...this.desired };
    } else {
      this.cur.x += (dx / d) * step;
      this.cur.y += (dy / d) * step;
    }

    // --- SERVE -----------------------------------------------------------
    if (sim.phase === 'serving' && sim.score.serving === this.side) {
      this.serveTimer += dt;
      // Sit on the ball, then serve after a beat.
      this.cur.x = me.x;
      this.cur.y = me.y;
      if (this.serveTimer > 0.7) {
        this.serveTimer = 0;
        this.aimAt(this.pickTarget(sim, opp));
        this.power = this.randPower();
        this.swingId += 1;
      }
    } else {
      this.serveTimer = 0;
    }

    // --- RALLY HIT -------------------------------------------------------
    if (sim.phase === 'rally') {
      const dist = Math.hypot(ball.x - this.cur.x, ball.y - this.cur.y);
      const reachable = dist <= this.p.reach && ball.z <= HIT_MAX_HEIGHT;
      // Respect the two-bounce rule: don't volley before we're allowed.
      const wouldVolley = ball.z > BALL_RADIUS + 0.1 && !sim.rally.bounceSinceLastHit;
      const legal = !(wouldVolley && !sim.rally.canVolley[this.side]);
      const mayHit = reachable && legal && sim.rally.lastHitBy !== this.side;
      if (mayHit && Math.random() > this.p.miss) {
        this.aimAt(this.pickTarget(sim, opp));
        this.power = this.randPower();
        this.swingId += 1;
      }
    }

    return {
      seq: ++this.seq,
      targetX: this.cur.x,
      targetY: this.cur.y,
      charging: false,
      swingId: this.swingId,
      aimX: this.aimX,
      aimY: this.aimY,
      power: this.power,
    };
  }

  private randPower() {
    return this.p.powMin + Math.random() * (this.p.powMax - this.p.powMin);
  }

  /** Aim toward the opponent's open court (away from their paddle), with noise. */
  private pickTarget(sim: GameSim, opp: Side): { x: number; y: number } {
    const hp = sim.paddles[opp];
    const deepX = opp === 'A' ? 4.5 : COURT_LENGTH - 4.5;
    // Aim to the far side from the opponent, scaled down on easier levels.
    const away = hp.y < CENTER_Y ? 1 : -1;
    let ty = CENTER_Y + away * (COURT_WIDTH * 0.32) * (1 - this.p.aimNoise * 0.6);
    ty += (Math.random() * 2 - 1) * this.p.aimNoise * COURT_WIDTH * 0.5;
    return { x: deepX, y: clamp(ty, 1.5, COURT_WIDTH - 1.5) };
  }

  /** Store a unit aim direction toward the chosen target (forward + lateral). */
  private aimAt(t: { x: number; y: number }) {
    const fwd = this.side === 'A' ? 1 : -1;
    let ax = fwd;
    let ay = (t.y - this.cur.y) / Math.max(6, COURT_LENGTH * 0.4);
    const len = Math.hypot(ax, ay) || 1;
    this.aimX = ax / len;
    this.aimY = ay / len;
  }
}
