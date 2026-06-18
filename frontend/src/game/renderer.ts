/**
 * CourtRenderer — draws the premium top-down court to a 2D canvas.
 *
 * Design language: deep championship green felt, crisp warm-ivory lines, a
 * muted gold accent used sparingly, and depth conveyed through lighting,
 * vignette, the net's cast shadow, and the ball's height (shadow offset +
 * vertical lift + a restrained motion trail). No neon, no template gradients.
 *
 * This is pure rendering. It receives an already-interpolated world state and
 * the local player's predicted paddle; it owns no game logic.
 */
import {
  BALL_RADIUS,
  CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  KITCHEN_A_MIN_X,
  KITCHEN_B_MAX_X,
  NET_X,
  WORLD_MAX_X,
  WORLD_MAX_Y,
  WORLD_MIN_X,
  WORLD_MIN_Y,
} from '../shared/constants';
import type { RenderState } from './netState';
import type { ScoreState, Side } from '../shared/types';

const C = {
  night: '#0B1A12',
  felt: '#16432C',
  feltDeep: '#0F3322',
  feltLight: '#1C5436',
  kitchen: '#123D29',
  line: '#F3EAD8',
  lineDim: 'rgba(243,234,216,0.55)',
  gold: '#C8A24B',
  goldSoft: '#E4C97E',
  ball: '#D8F15B',
  teamA: '#F3EAD8',
  teamB: '#C8A24B',
};

const WORLD_W = WORLD_MAX_X - WORLD_MIN_X;
const WORLD_H = WORLD_MAX_Y - WORLD_MIN_Y;

interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

export class CourtRenderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private dpr = 1;
  private trail: TrailPoint[] = [];
  reducedMotion = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    const fit = 0.96;
    this.scale = Math.min(this.canvas.width / WORLD_W, this.canvas.height / WORLD_H) * fit;
    this.offX = (this.canvas.width - WORLD_W * this.scale) / 2;
    this.offY = (this.canvas.height - WORLD_H * this.scale) / 2;
  }

  private sx(x: number) {
    return this.offX + (x - WORLD_MIN_X) * this.scale;
  }
  private sy(y: number) {
    return this.offY + (WORLD_MAX_Y - y) * this.scale;
  }
  private s(v: number) {
    return v * this.scale;
  }

  draw(state: RenderState, mySide: Side | null, predictedOwn: { x: number; y: number } | null) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawBackground();
    this.drawCourt();
    this.drawLines(state.score);
    this.drawNet();

    // Paddles: draw opponent from interpolation, own from prediction.
    const a = mySide === 'A' && predictedOwn ? predictedOwn : state.paddles.A;
    const b = mySide === 'B' && predictedOwn ? predictedOwn : state.paddles.B;
    this.drawPaddle('A', a, state, mySide);
    this.drawPaddle('B', b, state, mySide);

    this.drawBall(state.ball);
  }

  // -- layers --------------------------------------------------------------
  private drawBackground() {
    const { ctx, canvas } = this;
    const g = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height * 0.42,
      canvas.height * 0.1,
      canvas.width / 2,
      canvas.height / 2,
      canvas.height * 0.95,
    );
    g.addColorStop(0, '#0E2418');
    g.addColorStop(1, C.night);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private courtRect() {
    return {
      x: this.sx(0),
      y: this.sy(COURT_WIDTH),
      w: this.s(COURT_LENGTH),
      h: this.s(COURT_WIDTH),
    };
  }

  private drawCourt() {
    const { ctx } = this;
    const r = this.courtRect();
    const pad = this.s(2.2);

    // Court bed shadow for lift.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = this.s(2.5);
    ctx.shadowOffsetY = this.s(0.8);
    roundRect(ctx, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, this.s(1.2));
    ctx.fillStyle = C.feltDeep;
    ctx.fill();
    ctx.restore();

    // Felt with a soft vertical sheen.
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, C.feltLight);
    g.addColorStop(0.5, C.felt);
    g.addColorStop(1, C.feltDeep);
    roundRect(ctx, r.x, r.y, r.w, r.h, this.s(0.6));
    ctx.fillStyle = g;
    ctx.fill();

    // Kitchen (non-volley zone) shaded slightly cooler.
    ctx.fillStyle = C.kitchen;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(this.sx(KITCHEN_A_MIN_X), r.y, this.s(NET_X - KITCHEN_A_MIN_X), r.h);
    ctx.fillRect(this.sx(NET_X), r.y, this.s(KITCHEN_B_MAX_X - NET_X), r.h);
    ctx.globalAlpha = 1;

    // Center light sweep for a broadcast feel.
    const lg = ctx.createRadialGradient(
      this.sx(NET_X),
      this.sy(CENTER_Y),
      this.s(1),
      this.sx(NET_X),
      this.sy(CENTER_Y),
      this.s(26),
    );
    lg.addColorStop(0, 'rgba(243,234,216,0.06)');
    lg.addColorStop(1, 'rgba(243,234,216,0)');
    ctx.fillStyle = lg;
    roundRect(ctx, r.x, r.y, r.w, r.h, this.s(0.6));
    ctx.fill();
  }

  private line(x1: number, y1: number, x2: number, y2: number, w = 0.18, color = C.line) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, this.s(w));
    ctx.strokeStyle = color;
    ctx.moveTo(this.sx(x1), this.sy(y1));
    ctx.lineTo(this.sx(x2), this.sy(y2));
    ctx.stroke();
  }

  private drawLines(score: ScoreState | null) {
    // Perimeter
    this.line(0, 0, COURT_LENGTH, 0);
    this.line(0, COURT_WIDTH, COURT_LENGTH, COURT_WIDTH);
    this.line(0, 0, 0, COURT_WIDTH);
    this.line(COURT_LENGTH, 0, COURT_LENGTH, COURT_WIDTH);
    // Kitchen lines
    this.line(KITCHEN_A_MIN_X, 0, KITCHEN_A_MIN_X, COURT_WIDTH);
    this.line(KITCHEN_B_MAX_X, 0, KITCHEN_B_MAX_X, COURT_WIDTH);
    // Centerline only behind the kitchen (the service courts)
    this.line(0, CENTER_Y, KITCHEN_A_MIN_X, CENTER_Y, 0.14, C.lineDim);
    this.line(KITCHEN_B_MAX_X, CENTER_Y, COURT_LENGTH, CENTER_Y, 0.14, C.lineDim);

    // Subtle gold highlight on the active service court (where the next serve goes).
    if (score && (score.serving === 'A' || score.serving === 'B')) {
      const { ctx } = this;
      ctx.save();
      ctx.fillStyle = 'rgba(200,162,75,0.10)';
      const bottom = score.serving === 'A' ? score.serviceCourt === 'right' : score.serviceCourt === 'left';
      const yMin = bottom ? 0 : CENTER_Y;
      const xMin = score.serving === 'A' ? 0 : KITCHEN_B_MAX_X;
      const xW = score.serving === 'A' ? KITCHEN_A_MIN_X : COURT_LENGTH - KITCHEN_B_MAX_X;
      ctx.fillRect(this.sx(xMin), this.sy(yMin + CENTER_Y), this.s(xW), this.s(CENTER_Y));
      ctx.restore();
    }
  }

  private drawNet() {
    const { ctx } = this;
    const xTop = this.sx(NET_X);
    const yTop = this.sy(COURT_WIDTH);
    const yBot = this.sy(0);

    // Cast shadow to the right for depth.
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = this.s(0.5);
    ctx.beginPath();
    ctx.moveTo(xTop + this.s(0.35), yTop);
    ctx.lineTo(xTop + this.s(0.35), yBot);
    ctx.stroke();
    ctx.restore();

    // Mesh: fine vertical strokes between two posts.
    ctx.save();
    ctx.strokeStyle = 'rgba(243,234,216,0.22)';
    ctx.lineWidth = Math.max(1, this.s(0.04));
    const step = this.s(0.7);
    for (let sx = xTop - this.s(0.45); sx <= xTop + this.s(0.45); sx += step) {
      ctx.beginPath();
      ctx.moveTo(sx, yTop);
      ctx.lineTo(sx, yBot);
      ctx.stroke();
    }
    // Tape (top band) + posts in gold.
    ctx.strokeStyle = C.goldSoft;
    ctx.lineWidth = Math.max(2, this.s(0.22));
    ctx.beginPath();
    ctx.moveTo(xTop, yTop);
    ctx.lineTo(xTop, yBot);
    ctx.stroke();
    ctx.fillStyle = C.gold;
    [yTop, yBot].forEach((py) => {
      ctx.beginPath();
      ctx.arc(xTop, py, Math.max(2, this.s(0.32)), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  private drawPaddle(
    side: Side,
    pos: { x: number; y: number },
    state: RenderState,
    mySide: Side | null,
  ) {
    const { ctx } = this;
    const color = side === 'A' ? C.teamA : C.teamB;
    const cx = this.sx(pos.x);
    const cy = this.sy(pos.y);
    const rad = this.s(1.05);

    // Ground shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + this.s(0.25), rad * 1.05, rad * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Disc with subtle ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.5, this.s(0.12));
    ctx.strokeStyle = side === 'A' ? C.gold : '#3a2f12';
    ctx.stroke();

    // "You" marker
    if (side === mySide) {
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 1.45, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(243,234,216,0.5)';
      ctx.lineWidth = Math.max(1, this.s(0.06));
      ctx.setLineDash([this.s(0.4), this.s(0.3)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Server pip
    if (state.score && state.score.serving === side && (state.phase === 'serving' || state.phase === 'rally')) {
      ctx.beginPath();
      ctx.arc(cx, cy - rad * 1.4, this.s(0.28), 0, Math.PI * 2);
      ctx.fillStyle = C.gold;
      ctx.fill();
    }
    ctx.restore();

    // Label
    ctx.save();
    ctx.fillStyle = 'rgba(11,26,18,0.85)';
    ctx.font = `${Math.max(9, this.s(0.9))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(side, cx, cy);
    ctx.restore();
  }

  private drawBall(ball: { x: number; y: number; z: number }) {
    const { ctx } = this;

    // Trail (skipped when reduced motion is requested).
    if (!this.reducedMotion) {
      this.trail.push({ x: ball.x, y: ball.y, z: ball.z });
      if (this.trail.length > 12) this.trail.shift();
      this.trail.forEach((t, i) => {
        const a = (i / this.trail.length) * 0.28;
        const lift = this.s(t.z);
        ctx.beginPath();
        ctx.arc(this.sx(t.x), this.sy(t.y) - lift, this.s(BALL_RADIUS) * (0.6 + i / this.trail.length), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(216,241,91,${a})`;
        ctx.fill();
      });
    }

    const groundX = this.sx(ball.x);
    const groundY = this.sy(ball.y);
    const lift = this.s(ball.z); // higher ball -> drawn higher on screen
    const ballScreenY = groundY - lift;

    // Shadow shrinks and fades as the ball rises.
    const shadowScale = Math.max(0.4, 1 - ball.z / 14);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.34 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(groundX, groundY + this.s(0.15), this.s(BALL_RADIUS) * 1.7 * shadowScale, this.s(BALL_RADIUS) * 0.9 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Ball with a soft glow.
    ctx.save();
    ctx.shadowColor = 'rgba(216,241,91,0.55)';
    ctx.shadowBlur = this.s(0.8);
    ctx.beginPath();
    ctx.arc(groundX, ballScreenY, this.s(BALL_RADIUS) * 1.6, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(
      groundX - this.s(0.05),
      ballScreenY - this.s(0.05),
      this.s(0.02),
      groundX,
      ballScreenY,
      this.s(BALL_RADIUS) * 1.6,
    );
    bg.addColorStop(0, '#F4FBC0');
    bg.addColorStop(1, C.ball);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
  }

  clearTrail() {
    this.trail = [];
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
