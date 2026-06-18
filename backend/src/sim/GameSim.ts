/**
 * GameSim — the authoritative pickleball simulation.
 *
 * The SERVER owns this. Clients only send intent (InputReq) and render
 * interpolated snapshots. Nothing here trusts the client beyond movement
 * intent, which is clamped and validated. This is what prevents cheating and
 * keeps both players in agreement: there is exactly one source of truth.
 */
import {
  BALL_RADIUS,
  CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  HIT_MAX_HEIGHT,
  HIT_POWER,
  NET_X,
  PADDLE_REACH,
  PADDLE_SPEED,
  SERVE_POWER,
  WORLD_MAX_X,
  WORLD_MAX_Y,
  WORLD_MIN_X,
  WORLD_MIN_Y,
} from '../shared/constants';
import type {
  GameEvent,
  GameSnapshot,
  InputReq,
  Phase,
  RuleConfig,
  ScoreState,
  Side,
} from '../shared/types';
import { stepBall, type BallState } from './physics';
import {
  diagonalTarget,
  evaluateServeLanding,
  inKitchen,
  opponent,
  resolveRally,
  serviceBox,
  serviceCourtFor,
} from './rules';

interface PaddleRuntime {
  x: number;
  y: number;
  input: InputReq;
  lastSeq: number;
  hitCooldown: number; // seconds until this side may hit again
}

interface RallyTracking {
  lastHitBy: Side | null;
  bounceSinceLastHit: boolean;
  serveInProgress: boolean;
  canVolley: Record<Side, boolean>;
}

const POINT_PAUSE_S = 1.6;
const COUNTDOWN_S = 3;

export class GameSim {
  phase: Phase = 'lobby';
  tick = 0;
  ball: BallState = { x: NET_X, y: CENTER_Y, z: BALL_RADIUS, vx: 0, vy: 0, vz: 0 };
  score: ScoreState = {
    A: 0,
    B: 0,
    serving: 'A',
    serverNumber: 1,
    serviceCourt: 'right',
  };
  paddles: Record<Side, PaddleRuntime> = {
    A: makePaddle('A'),
    B: makePaddle('B'),
  };

  private rally: RallyTracking = freshRally();
  private timer = 0; // generic phase timer (countdown / point pause)
  private events: GameEvent[] = [];

  constructor(public rules: RuleConfig) {}

  // -- lifecycle -----------------------------------------------------------
  startMatch() {
    this.score = { A: 0, B: 0, serving: 'A', serverNumber: 1, serviceCourt: 'right' };
    this.resetPaddles();
    this.phase = 'countdown';
    this.timer = COUNTDOWN_S;
  }

  rematch() {
    this.startMatch();
  }

  pause() {
    if (this.phase !== 'matchOver') this.phase = 'paused';
  }

  resume() {
    if (this.phase === 'paused') this.beginServe();
  }

  applyInput(side: Side, input: InputReq) {
    const p = this.paddles[side];
    if (input.seq <= p.lastSeq) return; // ignore stale/duplicate
    p.input = input;
    p.lastSeq = input.seq;
  }

  /** Drain queued events for broadcasting. */
  takeEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // -- main step -----------------------------------------------------------
  step(dt: number) {
    this.tick++;
    this.movePaddles(dt);

    switch (this.phase) {
      case 'countdown':
        this.timer -= dt;
        if (this.timer <= 0) this.beginServe();
        break;
      case 'serving':
        this.holdServe();
        break;
      case 'rally':
        this.stepRally(dt);
        break;
      case 'pointOver':
        this.timer -= dt;
        if (this.timer <= 0) this.beginServe();
        break;
      default:
        break; // lobby / paused / matchOver: ball is frozen
    }
  }

  // -- movement ------------------------------------------------------------
  private movePaddles(dt: number) {
    (['A', 'B'] as Side[]).forEach((side) => {
      const p = this.paddles[side];
      const len = Math.hypot(p.input.dirX, p.input.dirY) || 1;
      p.x += (p.input.dirX / len) * PADDLE_SPEED * dt * (Math.abs(p.input.dirX) > 0 || Math.abs(p.input.dirY) > 0 ? 1 : 0);
      p.y += (p.input.dirY / len) * PADDLE_SPEED * dt * (Math.abs(p.input.dirX) > 0 || Math.abs(p.input.dirY) > 0 ? 1 : 0);
      // Clamp each player to their own half + the world bounds.
      const xMin = side === 'A' ? WORLD_MIN_X : NET_X + 0.3;
      const xMax = side === 'A' ? NET_X - 0.3 : WORLD_MAX_X;
      p.x = clamp(p.x, xMin, xMax);
      p.y = clamp(p.y, WORLD_MIN_Y, WORLD_MAX_Y);
      if (p.hitCooldown > 0) p.hitCooldown -= dt;
    });
  }

  // -- serving -------------------------------------------------------------
  private beginServe() {
    this.phase = 'serving';
    this.rally = freshRally();
    this.score.serviceCourt = serviceCourtFor(this.score[this.score.serving]);
    // Park the ball at the server's service position behind the baseline.
    const server = this.score.serving;
    const box = serviceBox(server, this.score.serviceCourt);
    const x = server === 'A' ? Math.max(WORLD_MIN_X + 1.5, 1.0) : Math.min(WORLD_MAX_X - 1.5, COURT_LENGTH - 1.0);
    const y = (box.yMin + box.yMax) / 2;
    this.ball = { x, y, z: 1.0, vx: 0, vy: 0, vz: 0 };
    // Nudge the server paddle to a sensible serving spot.
    this.paddles[server].x = x;
    this.paddles[server].y = y;
  }

  private holdServe() {
    const server = this.score.serving;
    const p = this.paddles[server];
    // Ball tracks the server until they serve.
    this.ball.x = p.x;
    this.ball.y = p.y;
    this.ball.z = 1.0;
    if (p.input.serve && p.hitCooldown <= 0) {
      this.launchServe(server, p.input.aimY);
    }
  }

  private launchServe(server: Side, aimY: number) {
    const target = diagonalTarget(server);
    const box = serviceBox(target.side, serviceCourtFor(this.score[server]));
    const targetX = (box.xMin + box.xMax) / 2;
    const targetY = (box.yMin + box.yMax) / 2 + aimY * 4;

    const dir = server === 'A' ? 1 : -1;
    this.ball.vx = dir * SERVE_POWER;
    // Lateral velocity to drift toward the diagonal target.
    this.ball.vy = clamp((targetY - this.ball.y) * 0.9, -SERVE_POWER * 0.5, SERVE_POWER * 0.5);
    // Upward arc tuned so the ball comes down near the target box.
    this.ball.vz = 9.5;
    void targetX;

    this.rally.lastHitBy = server;
    this.rally.serveInProgress = true;
    this.rally.bounceSinceLastHit = false;
    this.phase = 'rally';
    this.paddles[server].hitCooldown = 0.4;
    this.emit({ type: 'serve', side: server });
  }

  // -- rally ---------------------------------------------------------------
  private stepRally(dt: number) {
    // Player hit attempts first (so a fast ball can be intercepted).
    (['A', 'B'] as Side[]).forEach((side) => this.tryHit(side));

    const res = stepBall(this.ball, dt);

    if (res.hitNet) {
      // Whoever last touched it failed to clear the net.
      const loser = this.rally.lastHitBy ?? this.score.serving;
      this.resolvePoint(opponent(loser), 'net');
      return;
    }

    if (res.bounced) {
      const bSide = res.bounceSide!;
      // Serve landing is judged on its first bounce.
      if (this.rally.serveInProgress) {
        const fault = evaluateServeLanding(
          this.score.serving,
          this.score[this.score.serving],
          this.ball.x,
          this.ball.y,
          false,
          this.rules,
        );
        this.rally.serveInProgress = false;
        if (fault) {
          this.resolvePoint(opponent(this.score.serving), fault);
          return;
        }
        this.rally.canVolley[bSide] = true;
        this.rally.bounceSinceLastHit = true;
        return;
      }

      // Out of bounds => the side that hit it last loses.
      if (!res.bounceInBounds) {
        const loser = this.rally.lastHitBy ?? opponent(bSide);
        this.resolvePoint(opponent(loser), 'out');
        return;
      }

      // Double bounce => the side that let it bounce twice loses.
      if (this.rally.bounceSinceLastHit) {
        this.resolvePoint(opponent(bSide), 'doubleBounce');
        return;
      }

      this.rally.bounceSinceLastHit = true;
      this.rally.canVolley[bSide] = true;
      this.emit({ type: 'bounce', side: bSide });
    }
  }

  private tryHit(side: Side) {
    const p = this.paddles[side];
    if (!p.input.hit || p.hitCooldown > 0) return;
    if (this.phase !== 'rally') return;

    const dx = Math.abs(this.ball.x - p.x);
    const dy = Math.abs(this.ball.y - p.y);
    if (dx > PADDLE_REACH || dy > PADDLE_REACH || this.ball.z > HIT_MAX_HEIGHT) return;

    // Only let a side hit a ball that is on/over their region or just past it.
    const onMySide = side === 'A' ? this.ball.x <= NET_X + PADDLE_REACH : this.ball.x >= NET_X - PADDLE_REACH;
    if (!onMySide) return;

    const isVolley = this.ball.z > BALL_RADIUS + 0.05 && !this.rally.bounceSinceLastHit;

    // Two-bounce rule: cannot volley until this side has had its bounce.
    if (isVolley && this.rules.twoBounceRule && !this.rally.canVolley[side]) {
      this.resolvePoint(opponent(side), 'twoBounceViolation');
      return;
    }
    // Kitchen rule: no volleys while standing in the non-volley zone.
    if (isVolley && this.rules.enforceKitchen && inKitchen(side, p.x)) {
      this.resolvePoint(opponent(side), 'kitchenVolley');
      return;
    }

    // Legal hit: send the ball back across with an arc + player aim.
    const dir = side === 'A' ? 1 : -1;
    this.ball.vx = dir * HIT_POWER;
    this.ball.vy = clamp(p.input.aimY * HIT_POWER * 0.5 + (this.ball.y - CENTER_Y) * 0.2, -HIT_POWER * 0.6, HIT_POWER * 0.6);
    this.ball.vz = 7.5 + Math.random() * 1.5;

    this.rally.lastHitBy = side;
    this.rally.bounceSinceLastHit = false;
    p.hitCooldown = 0.22;
    this.emit({ type: 'hit', side });
  }

  // -- scoring -------------------------------------------------------------
  private resolvePoint(rallyWinner: Side, reason?: GameEvent['reason']) {
    const outcome = resolveRally(this.score, rallyWinner, this.rules);
    this.score = outcome.score;

    if (reason) this.emit({ type: 'fault', side: opponent(rallyWinner), reason });
    if (outcome.sideOut) this.emit({ type: 'sideout', side: rallyWinner });
    else this.emit({ type: 'point', side: rallyWinner });

    if (outcome.matchWinner) {
      this.phase = 'matchOver';
      this.emit({ type: 'matchOver', winner: outcome.matchWinner });
    } else {
      this.phase = 'pointOver';
      this.timer = POINT_PAUSE_S;
    }
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  private resetPaddles() {
    this.paddles.A = makePaddle('A');
    this.paddles.B = makePaddle('B');
  }

  // -- snapshot ------------------------------------------------------------
  snapshot(): GameSnapshot {
    return {
      tick: this.tick,
      serverTimeMs: Date.now(),
      phase: this.phase,
      ball: { ...this.ball },
      paddles: [
        { side: 'A', x: this.paddles.A.x, y: this.paddles.A.y },
        { side: 'B', x: this.paddles.B.x, y: this.paddles.B.y },
      ],
      score: { ...this.score },
      countdown: this.phase === 'countdown' ? Math.ceil(this.timer) : undefined,
      ack: { A: this.paddles.A.lastSeq, B: this.paddles.B.lastSeq },
    };
  }
}

// --- helpers ---------------------------------------------------------------
function makePaddle(side: Side): PaddleRuntime {
  return {
    x: side === 'A' ? COURT_LENGTH * 0.18 : COURT_LENGTH * 0.82,
    y: CENTER_Y,
    input: { seq: 0, dirX: 0, dirY: 0, hit: false, serve: false, aimY: 0 },
    lastSeq: 0,
    hitCooldown: 0,
  };
}

function freshRally(): RallyTracking {
  return {
    lastHitBy: null,
    bounceSinceLastHit: false,
    serveInProgress: false,
    canVolley: { A: false, B: false },
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
void COURT_WIDTH;
void WORLD_MAX_Y;
