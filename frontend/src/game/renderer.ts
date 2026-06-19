/**
 * CourtRenderer — premium top-down court, drawn VERTICALLY with the local
 * player's own side at the BOTTOM of their screen.
 *
 * The simulation is always horizontal (A at x=0, B at x=44). Here we rotate the
 * world into screen space based on `mySide`: Team A views +x going up the
 * screen; Team B views the same court rotated 180° (so each player's baseline is
 * nearest them). All other clients stay perfectly in sync because only the VIEW
 * rotates — never the simulation.
 *
 * Also renders the slingshot aim line + charge meter for the local player.
 */
import {
  BALL_RADIUS,
  CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  KITCHEN_A_MIN_X,
  KITCHEN_B_MAX_X,
  NET_X,
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

const LAYOUT_MARGIN = 3.5; // ft of breathing room drawn around the court

export interface SwingViz {
  charging: boolean; // charging a serve
  power: number; // 0..1
  aimX: number; // world dir
  aimY: number;
  flash: number; // 0..1 contact pulse (rally hit feedback)
}

interface TrailPoint {
  x: number;
  y: number;
  z: number;
}

export class CourtRenderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private dpr = 1;
  private trail: TrailPoint[] = [];
  mySide: Side = 'A';
  reducedMotion = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not supported');
    this.ctx = ctx;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.resize();
  }

  setMySide(side: Side | null) {
    this.mySide = side ?? 'A';
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    const acrossFt = COURT_WIDTH + LAYOUT_MARGIN * 2; // horizontal extent (y)
    const alongFt = COURT_LENGTH + LAYOUT_MARGIN * 2; // vertical extent (x)
    this.scale =
      Math.min(this.canvas.width / acrossFt, this.canvas.height / alongFt) * 0.98;
  }

  // -- coordinate transforms (the only place orientation lives) ------------
  private get scx() {
    return this.canvas.width / 2;
  }
  private get scy() {
    return this.canvas.height / 2;
  }

  /** World (feet) -> screen (device px). */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const s = this.scale;
    if (this.mySide === 'B') {
      return { x: this.scx - (wy - CENTER_Y) * s, y: this.scy - (NET_X - wx) * s };
    }
    return { x: this.scx + (wy - CENTER_Y) * s, y: this.scy + (NET_X - wx) * s };
  }

  /** Canvas CSS px -> world (feet). */
  screenToWorld(cssX: number, cssY: number): { x: number; y: number } {
    const px = cssX * this.dpr;
    const py = cssY * this.dpr;
    const s = this.scale;
    if (this.mySide === 'B') {
      return { x: NET_X + (py - this.scy) / s, y: CENTER_Y - (px - this.scx) / s };
    }
    return { x: NET_X - (py - this.scy) / s, y: CENTER_Y + (px - this.scx) / s };
  }

  /** A screen drag delta (CSS px) -> normalized world direction. */
  screenDirToWorld(cssDx: number, cssDy: number): { x: number; y: number } {
    const s = this.scale;
    const dx = cssDx * this.dpr;
    const dy = cssDy * this.dpr;
    let wx: number;
    let wy: number;
    if (this.mySide === 'B') {
      wy = -dx / s;
      wx = dy / s;
    } else {
      wy = dx / s;
      wx = -dy / s;
    }
    const len = Math.hypot(wx, wy) || 1;
    return { x: wx / len, y: wy / len };
  }

  private sv(v: number) {
    return v * this.scale;
  }

  /** CSS px per court-foot (for screen-space contact math in the loop). */
  get pxPerFootCss() {
    return this.scale / this.dpr;
  }

  /** Paddle/ground world point -> canvas CSS px. */
  worldToScreenCss(x: number, y: number): { x: number; y: number } {
    const p = this.worldToScreen(x, y);
    return { x: p.x / this.dpr, y: p.y / this.dpr };
  }

  /** The ball's DRAWN position (its height lifts it up-screen) in CSS px. */
  ballScreenCss(ball: { x: number; y: number; z: number }): { x: number; y: number } {
    const p = this.worldToScreen(ball.x, ball.y);
    return { x: p.x / this.dpr, y: (p.y - ball.z * this.scale) / this.dpr };
  }

  // -- main draw -----------------------------------------------------------
  draw(
    state: RenderState,
    mySide: Side | null,
    predictedOwn: { x: number; y: number } | null,
    viz?: SwingViz | null,
  ) {
    this.setMySide(mySide);
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawBackground();
    this.drawCourt();
    this.drawLines(state.score);
    this.drawNet();

    const a = mySide === 'A' && predictedOwn ? predictedOwn : state.paddles.A;
    const b = mySide === 'B' && predictedOwn ? predictedOwn : state.paddles.B;
    this.drawPaddle('A', a, state, mySide);
    this.drawPaddle('B', b, state, mySide);

    // Serve charge ring / aim, or a rally contact pulse, for the local player.
    const own = mySide === 'A' ? a : mySide === 'B' ? b : null;
    if (own && viz) this.drawSwingViz(own, viz);

    this.drawBall(state.ball);
  }

  // -- layers --------------------------------------------------------------
  private drawBackground() {
    const { ctx, canvas } = this;
    const g = ctx.createRadialGradient(
      canvas.width / 2,
      canvas.height * 0.4,
      canvas.height * 0.08,
      canvas.width / 2,
      canvas.height / 2,
      canvas.height * 0.95,
    );
    g.addColorStop(0, '#0E2418');
    g.addColorStop(1, C.night);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /** Screen-space bounding box of a world rectangle (axis-aligned after rotate). */
  private wrect(x0: number, y0: number, x1: number, y1: number) {
    const a = this.worldToScreen(x0, y0);
    const b = this.worldToScreen(x1, y1);
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }

  private drawCourt() {
    const { ctx } = this;
    const r = this.wrect(0, 0, COURT_LENGTH, COURT_WIDTH);
    const pad = this.sv(2.2);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = this.sv(2.5);
    ctx.shadowOffsetY = this.sv(0.8);
    roundRect(ctx, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, this.sv(1.2));
    ctx.fillStyle = C.feltDeep;
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, C.feltLight);
    g.addColorStop(0.5, C.felt);
    g.addColorStop(1, C.feltDeep);
    roundRect(ctx, r.x, r.y, r.w, r.h, this.sv(0.6));
    ctx.fillStyle = g;
    ctx.fill();

    // Kitchen zones.
    ctx.save();
    ctx.fillStyle = C.kitchen;
    ctx.globalAlpha = 0.55;
    const ka = this.wrect(KITCHEN_A_MIN_X, 0, NET_X, COURT_WIDTH);
    const kb = this.wrect(NET_X, 0, KITCHEN_B_MAX_X, COURT_WIDTH);
    ctx.fillRect(ka.x, ka.y, ka.w, ka.h);
    ctx.fillRect(kb.x, kb.y, kb.w, kb.h);
    ctx.restore();

    // Soft light sweep at the net.
    const net = this.worldToScreen(NET_X, CENTER_Y);
    const lg = ctx.createRadialGradient(net.x, net.y, this.sv(1), net.x, net.y, this.sv(26));
    lg.addColorStop(0, 'rgba(243,234,216,0.06)');
    lg.addColorStop(1, 'rgba(243,234,216,0)');
    ctx.fillStyle = lg;
    roundRect(ctx, r.x, r.y, r.w, r.h, this.sv(0.6));
    ctx.fill();
  }

  private line(x1: number, y1: number, x2: number, y2: number, w = 0.18, color = C.line) {
    const { ctx } = this;
    const a = this.worldToScreen(x1, y1);
    const b = this.worldToScreen(x2, y2);
    ctx.beginPath();
    ctx.lineWidth = Math.max(1, this.sv(w));
    ctx.strokeStyle = color;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  private drawLines(score: ScoreState | null) {
    this.line(0, 0, COURT_LENGTH, 0);
    this.line(0, COURT_WIDTH, COURT_LENGTH, COURT_WIDTH);
    this.line(0, 0, 0, COURT_WIDTH);
    this.line(COURT_LENGTH, 0, COURT_LENGTH, COURT_WIDTH);
    this.line(KITCHEN_A_MIN_X, 0, KITCHEN_A_MIN_X, COURT_WIDTH);
    this.line(KITCHEN_B_MAX_X, 0, KITCHEN_B_MAX_X, COURT_WIDTH);
    this.line(0, CENTER_Y, KITCHEN_A_MIN_X, CENTER_Y, 0.14, C.lineDim);
    this.line(KITCHEN_B_MAX_X, CENTER_Y, COURT_LENGTH, CENTER_Y, 0.14, C.lineDim);

    if (score && (score.serving === 'A' || score.serving === 'B')) {
      const { ctx } = this;
      ctx.save();
      ctx.fillStyle = 'rgba(200,162,75,0.12)';
      const bottom = score.serving === 'A' ? score.serviceCourt === 'right' : score.serviceCourt === 'left';
      const yMin = bottom ? 0 : CENTER_Y;
      const yMax = bottom ? CENTER_Y : COURT_WIDTH;
      const xMin = score.serving === 'A' ? 0 : KITCHEN_B_MAX_X;
      const xMax = score.serving === 'A' ? KITCHEN_A_MIN_X : COURT_LENGTH;
      const box = this.wrect(xMin, yMin, xMax, yMax);
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }

  private drawNet() {
    const { ctx } = this;
    const a = this.worldToScreen(NET_X, 0);
    const b = this.worldToScreen(NET_X, COURT_WIDTH);

    // Cast shadow.
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = this.sv(0.5);
    ctx.beginPath();
    ctx.moveTo(a.x + this.sv(0.3), a.y + this.sv(0.3));
    ctx.lineTo(b.x + this.sv(0.3), b.y + this.sv(0.3));
    ctx.stroke();
    ctx.restore();

    // Mesh band.
    ctx.save();
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    ctx.strokeStyle = 'rgba(243,234,216,0.22)';
    ctx.lineWidth = Math.max(1, this.sv(0.04));
    for (let o = -this.sv(0.45); o <= this.sv(0.45); o += this.sv(0.7)) {
      ctx.beginPath();
      ctx.moveTo(a.x + nx * o, a.y + ny * o);
      ctx.lineTo(b.x + nx * o, b.y + ny * o);
      ctx.stroke();
    }
    // Tape + posts.
    ctx.strokeStyle = C.goldSoft;
    ctx.lineWidth = Math.max(2, this.sv(0.22));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.fillStyle = C.gold;
    [a, b].forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, this.sv(0.32)), 0, Math.PI * 2);
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
    const c = this.worldToScreen(pos.x, pos.y);
    const rad = this.sv(1.05);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y + this.sv(0.25), rad * 1.05, rad * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1.5, this.sv(0.12));
    ctx.strokeStyle = side === 'A' ? C.gold : '#3a2f12';
    ctx.stroke();

    if (side === mySide) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad * 1.45, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(243,234,216,0.5)';
      ctx.lineWidth = Math.max(1, this.sv(0.06));
      ctx.setLineDash([this.sv(0.4), this.sv(0.3)]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (state.score && state.score.serving === side && (state.phase === 'serving' || state.phase === 'rally')) {
      ctx.beginPath();
      ctx.arc(c.x, c.y - rad * 1.4, this.sv(0.28), 0, Math.PI * 2);
      ctx.fillStyle = C.gold;
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(11,26,18,0.85)';
    ctx.font = `${Math.max(9, this.sv(0.9))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(side, c.x, c.y);
    ctx.restore();
  }

  private drawSwingViz(own: { x: number; y: number }, viz: SwingViz) {
    const { ctx } = this;
    const c = this.worldToScreen(own.x, own.y);

    // Serve charge: forward aim arrow + power ring.
    if (viz.charging) {
      const reach = 3 + viz.power * 8;
      const to = this.worldToScreen(own.x + viz.aimX * reach, own.y + viz.aimY * reach);
      ctx.save();
      ctx.strokeStyle = `rgba(228,201,126,${0.35 + viz.power * 0.5})`;
      ctx.lineWidth = Math.max(2, this.sv(0.16));
      ctx.setLineDash([this.sv(0.5), this.sv(0.35)]);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const ang = Math.atan2(to.y - c.y, to.x - c.x);
      const ah = this.sv(0.7);
      ctx.fillStyle = C.goldSoft;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - ah * Math.cos(ang - 0.4), to.y - ah * Math.sin(ang - 0.4));
      ctx.lineTo(to.x - ah * Math.cos(ang + 0.4), to.y - ah * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();

      const rr = this.sv(1.7);
      ctx.lineWidth = Math.max(2, this.sv(0.18));
      ctx.strokeStyle = 'rgba(243,234,216,0.18)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = C.ball;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * viz.power);
      ctx.stroke();
      ctx.restore();
    }

    // Rally contact: a quick expanding pulse where the ball was struck.
    if (viz.flash > 0) {
      ctx.save();
      const rr = this.sv(1.3 + (1 - viz.flash) * 2.4);
      ctx.globalAlpha = viz.flash * 0.8;
      ctx.strokeStyle = C.goldSoft;
      ctx.lineWidth = Math.max(2, this.sv(0.2));
      ctx.beginPath();
      ctx.arc(c.x, c.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBall(ball: { x: number; y: number; z: number }) {
    const { ctx } = this;

    if (!this.reducedMotion) {
      this.trail.push({ x: ball.x, y: ball.y, z: ball.z });
      if (this.trail.length > 12) this.trail.shift();
      this.trail.forEach((t, i) => {
        const a = (i / this.trail.length) * 0.28;
        const p = this.worldToScreen(t.x, t.y);
        const lift = this.sv(t.z);
        ctx.beginPath();
        ctx.arc(p.x, p.y - lift, this.sv(BALL_RADIUS) * (0.6 + i / this.trail.length), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(216,241,91,${a})`;
        ctx.fill();
      });
    }

    const g = this.worldToScreen(ball.x, ball.y);
    const lift = this.sv(ball.z);
    const ballY = g.y - lift;

    const shadowScale = Math.max(0.4, 1 - ball.z / 14);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${0.34 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y + this.sv(0.15), this.sv(BALL_RADIUS) * 1.7 * shadowScale, this.sv(BALL_RADIUS) * 0.9 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.shadowColor = 'rgba(216,241,91,0.55)';
    ctx.shadowBlur = this.sv(0.8);
    ctx.beginPath();
    ctx.arc(g.x, ballY, this.sv(BALL_RADIUS) * 1.6, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(g.x - this.sv(0.05), ballY - this.sv(0.05), this.sv(0.02), g.x, ballY, this.sv(BALL_RADIUS) * 1.6);
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
