/**
 * GameSim — the authoritative pickleball simulation.
 *
 * The SERVER owns this. Clients send intent (InputReq): a desired paddle
 * POSITION (mouse/finger 1:1) plus charge-and-release SWINGS. The server moves
 * paddles to the requested position (clamped to each player's half) and, on a
 * new swingId, performs a serve or a hit — always launching the ball on an arc
 * that is solved to clear the net, so rallies sustain.
 *
 * Coordinate system is fixed (A defends x<net, B defends x>net). Clients rotate
 * the view locally; the simulation never rotates.
 */
import {
  BALL_RADIUS,
  CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  HIT_MAX_HEIGHT,
  NET_X,
  PADDLE_REACH,
  SHOT_MAX_DIST,
  SHOT_MIN_DIST,
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
import { solveArc, stepBall, type BallState } from './physics';
import {
  diagonalTarget,
  evaluateServeLanding,
  inKitchen,
  opponent,
  resolveRally,
  serviceBox,
  serviceCourtFor,
} from './rules';

interface PendingSwing {
  aimX: number;
  aimY: number;
  power: number;
}

interface PaddleRuntime {
  x: number;
  y: number;
  input: InputReq;
  lastSeq: number;
  lastSwingId: number;
  pendingSwing: PendingSwing | null;
  hitCooldown: number;
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
  score: ScoreState = { A: 0, B: 0, serving: 'A', serverNumber: 1, serviceCourt: 'right' };
  paddles: Record<Side, PaddleRuntime> = { A: makePaddle('A'), B: makePaddle('B') };

  private rally: RallyTracking = freshRally();
  private timer = 0;
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
    if (input.seq <= p.lastSeq) return; // stale/duplicate
    p.input = input;
    p.lastSeq = input.seq;
    // A new swingId means the player released a charged swing.
    if (input.swingId > p.lastSwingId) {
      p.lastSwingId = input.swingId;
      p.pendingSwing = { aimX: input.aimX, aimY: input.aimY, power: clamp(input.power, 0, 1) };
    }
  }

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
        this.consumeServeSwing();
        break;
      case 'rally':
        this.consumeHitSwings();
        this.stepRally(dt);
        break;
      case 'pointOver':
        this.timer -= dt;
        if (this.timer <= 0) this.beginServe();
        break;
      default:
        break; // lobby / paused / matchOver: ball frozen
    }

    // Drop any swings that couldn't be used this phase so they don't linger.
    this.paddles.A.pendingSwing = this.phase === 'serving' || this.phase === 'rally' ? this.paddles.A.pendingSwing : null;
    this.paddles.B.pendingSwing = this.phase === 'serving' || this.phase === 'rally' ? this.paddles.B.pendingSwing : null;
  }

  // -- movement: paddle follows the client's requested position 1:1 --------
  private movePaddles(dt: number) {
    (['A', 'B'] as Side[]).forEach((side) => {
      const p = this.paddles[side];
      const xMin = side === 'A' ? WORLD_MIN_X : NET_X + 0.3;
      const xMax = side === 'A' ? NET_X - 0.3 : WORLD_MAX_X;
      p.x = clamp(p.input.targetX, xMin, xMax);
      p.y = clamp(p.input.targetY, WORLD_MIN_Y, WORLD_MAX_Y);
      if (p.hitCooldown > 0) p.hitCooldown -= dt;
    });
  }

  // -- serving -------------------------------------------------------------
  private beginServe() {
    this.phase = 'serving';
    this.rally = freshRally();
    this.score.serviceCourt = serviceCourtFor(this.score[this.score.serving]);
    const server = this.score.serving;
    const court = serviceCourtFor(this.score[server]);
    const ownBox = serviceBox(server, court);
    const x = server === 'A' ? Math.max(WORLD_MIN_X + 1.5, 1.0) : Math.min(WORLD_MAX_X - 1.5, COURT_LENGTH - 1.0);
    const y = (ownBox.yMin + ownBox.yMax) / 2;
    this.ball = { x, y, z: 1.0, vx: 0, vy: 0, vz: 0 };
    // Seed the server paddle (and its input target) at the serving spot.
    const p = this.paddles[server];
    p.x = x;
    p.y = y;
    p.input.targetX = x;
    p.input.targetY = y;
    p.pendingSwing = null;
    this.paddles[opponent(server)].pendingSwing = null;
  }

  private holdServe() {
    const server = this.score.serving;
    const p = this.paddles[server];
    this.ball.x = p.x;
    this.ball.y = p.y;
    this.ball.z = 1.0;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.vz = 0;
  }

  private consumeServeSwing() {
    const server = this.score.serving;
    const p = this.paddles[server];
    if (!p.pendingSwing || p.hitCooldown > 0) return;
    const swing = p.pendingSwing;
    p.pendingSwing = null;
    this.launchServe(server, swing);
  }

  private launchServe(server: Side, swing: PendingSwing) {
    // Serve must land in the diagonal service box. We aim at that box's centre
    // (nudged a little by the player's aim/power) and clamp inside it, so a
    // casual serve is reliably legal and the rally can begin.
    const court = serviceCourtFor(this.score[server]);
    const target = diagonalTarget(server);
    const box = serviceBox(target.side, court);
    const inset = 1.4;
    const cx = (box.xMin + box.xMax) / 2;
    const cy = (box.yMin + box.yMax) / 2;
    const tx = clamp(cx + swing.aimX * 2 + (swing.power - 0.5) * 3, box.xMin + inset, box.xMax - inset);
    const ty = clamp(cy + swing.aimY * 4, box.yMin + inset, box.yMax - inset);

    const v = solveArc({ x: this.ball.x, y: this.ball.y, z: this.ball.z }, tx, ty);
    this.ball.vx = v.vx;
    this.ball.vy = v.vy;
    this.ball.vz = v.vz;

    this.rally.lastHitBy = server;
    this.rally.serveInProgress = true;
    this.rally.bounceSinceLastHit = false;
    this.phase = 'rally';
    this.paddles[server].hitCooldown = 0.35;
    this.emit({ type: 'serve', side: server });
  }

  // -- rally ---------------------------------------------------------------
  private consumeHitSwings() {
    (['A', 'B'] as Side[]).forEach((side) => {
      const p = this.paddles[side];
      if (!p.pendingSwing) return;
      const swing = p.pendingSwing;
      p.pendingSwing = null;
      this.tryHit(side, swing);
    });
  }

  private tryHit(side: Side, swing: PendingSwing) {
    const p = this.paddles[side];
    if (p.hitCooldown > 0) return;

    const dx = Math.abs(this.ball.x - p.x);
    const dy = Math.abs(this.ball.y - p.y);
    if (dx > PADDLE_REACH || dy > PADDLE_REACH || this.ball.z > HIT_MAX_HEIGHT) return; // whiff

    const onMySide = side === 'A' ? this.ball.x <= NET_X + PADDLE_REACH : this.ball.x >= NET_X - PADDLE_REACH;
    if (!onMySide) return;

    const isVolley = this.ball.z > BALL_RADIUS + 0.05 && !this.rally.bounceSinceLastHit;
    if (isVolley && this.rules.twoBounceRule && !this.rally.canVolley[side]) {
      this.resolvePoint(opponent(side), 'twoBounceViolation');
      return;
    }
    if (isVolley && this.rules.enforceKitchen && inKitchen(side, p.x)) {
      this.resolvePoint(opponent(side), 'kitchenVolley');
      return;
    }

    // Resolve the swing into a landing point in the opponent's court, then
    // solve an arc that clears the net to get there.
    const dist = SHOT_MIN_DIST + (SHOT_MAX_DIST - SHOT_MIN_DIST) * swing.power;
    let tx = this.ball.x + swing.aimX * dist;
    let ty = this.ball.y + swing.aimY * dist;

    // Force the shot into the opponent's half and keep it in play.
    const oppMinX = side === 'A' ? NET_X + 1.5 : 1.0;
    const oppMaxX = side === 'A' ? COURT_LENGTH - 1.0 : NET_X - 1.5;
    tx = clamp(tx, oppMinX, oppMaxX);
    ty = clamp(ty, 1.0, COURT_WIDTH - 1.0);

    const v = solveArc({ x: this.ball.x, y: this.ball.y, z: this.ball.z }, tx, ty);
    this.ball.vx = v.vx;
    this.ball.vy = v.vy;
    this.ball.vz = v.vz;

    this.rally.lastHitBy = side;
    this.rally.bounceSinceLastHit = false;
    p.hitCooldown = 0.2;
    this.emit({ type: 'hit', side });
  }

  private stepRally(dt: number) {
    const res = stepBall(this.ball, dt);

    if (res.hitNet) {
      const loser = this.rally.lastHitBy ?? this.score.serving;
      this.resolvePoint(opponent(loser), 'net');
      return;
    }

    if (res.bounced) {
      const bSide = res.bounceSide!;
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
        this.emit({ type: 'bounce', side: bSide });
        return;
      }

      if (!res.bounceInBounds) {
        const loser = this.rally.lastHitBy ?? opponent(bSide);
        this.resolvePoint(opponent(loser), 'out');
        return;
      }

      if (this.rally.bounceSinceLastHit) {
        this.resolvePoint(opponent(bSide), 'doubleBounce');
        return;
      }

      this.rally.bounceSinceLastHit = true;
      this.rally.canVolley[bSide] = true;
      this.emit({ type: 'bounce', side: bSide });
    }
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
  const x = side === 'A' ? COURT_LENGTH * 0.14 : COURT_LENGTH * 0.86;
  return {
    x,
    y: CENTER_Y,
    input: {
      seq: 0,
      targetX: x,
      targetY: CENTER_Y,
      charging: false,
      swingId: 0,
      aimX: side === 'A' ? 1 : -1,
      aimY: 0,
      power: 0,
    },
    lastSeq: 0,
    lastSwingId: 0,
    pendingSwing: null,
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
