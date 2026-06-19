/**
 * useGameLoop — the client runtime (air-hockey model).
 *
 *   1. The paddle ALWAYS follows the cursor / finger 1:1 — it never locks.
 *   2. RALLY: when your puck visually touches the ball, it is struck. Contact is
 *      checked in SCREEN space (cursor vs the drawn, height-lifted ball) so "what
 *      you see is what you hit". The SPEED + DIRECTION of your swipe become the
 *      shot's power and aim — like air hockey.
 *   3. SERVE: a forward flick of your puck launches the serve in that direction
 *      (no charging, you can always move). The server keeps it legal + over the net.
 *
 * Mouse and touch share one path. Contact and the swipe are detected on the
 * client (it owns the paddle), so it feels responsive even at real-world ping.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  CONTACT_REACH,
  HIT_COOLDOWN_S,
  HIT_MAX_HEIGHT,
  INPUT_RATE,
  NET_X,
  PADDLE_SPEED,
  SERVE_MIN_SWIPE,
  SWIPE_FULL_SPEED,
  WORLD_MAX_X,
  WORLD_MAX_Y,
  WORLD_MIN_X,
  WORLD_MIN_Y,
} from '../shared/constants';
import type { Side } from '../shared/types';
import { CourtRenderer, type SwingViz } from './renderer';
import { getRenderState } from './netState';
import { inputState, setPointer, setTarget, commitSwing, resetInput } from './input';
import { sendInput } from '../net/socket';
import { useStore } from '../state/store';

interface Vec {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function clampHalf(side: Side, p: Vec): Vec {
  const m = 0.4;
  const xMin = side === 'A' ? WORLD_MIN_X + m : NET_X + 0.5;
  const xMax = side === 'A' ? NET_X - 0.5 : WORLD_MAX_X - m;
  return {
    x: clamp(p.x, xMin, xMax),
    y: clamp(p.y, WORLD_MIN_Y + m, WORLD_MAX_Y - m),
  };
}

export function useGameLoop(
  canvasRef: RefObject<HTMLCanvasElement>,
  mySide: Side | null,
  active: boolean,
) {
  const playerId = useStore((s) => s.playerId);
  const predicted = useRef<Vec | null>(null);
  const seq = useRef(0);
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const renderer = new CourtRenderer(canvas);
    renderer.setMySide(mySide);
    resetInput(mySide);

    const start = clampHalf(mySide ?? 'A', { x: mySide === 'B' ? 37 : 7, y: 10 });
    setTarget(start.x, start.y);
    predicted.current = { ...start };

    const prevTarget: Vec = { ...start };
    const vel: Vec = { x: 0, y: 0 }; // smoothed paddle velocity, world ft/s
    let lastHitTime = -9999;
    let hitFlashTime = -9999;
    let lastServeTime = -9999;
    let serveArmTime = -9999;
    let prevPhase: string | null = null;

    const localPoint = (clientX: number, clientY: number): Vec => {
      const r = canvas.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const moveTo = (p: Vec) => {
      setPointer(p.x, p.y);
      const w = renderer.screenToWorld(p.x, p.y);
      const c = clampHalf(mySide ?? 'A', w);
      setTarget(c.x, c.y);
    };

    // -- pointer (mouse + touch) -------------------------------------------
    const onPointerMove = (e: PointerEvent) => moveTo(localPoint(e.clientX, e.clientY));
    const onPointerDown = (e: PointerEvent) => moveTo(localPoint(e.clientX, e.clientY));
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        vel.x = 0;
        vel.y = 0;
      }
    };
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    // -- keyboard (optional WASD nudge) ------------------------------------
    const onKeyDown = (e: KeyboardEvent) => {
      keys.current.add(e.key.toLowerCase());
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);

    let raf = 0;
    let last = performance.now();
    let inputAccum = 0;
    const inputInterval = 1000 / INPUT_RATE;

    const frame = (now: number) => {
      const dt = clamp((now - last) / 1000, 0.0001, 0.05);
      last = now;

      let target = clampHalf(mySide ?? 'A', { x: inputState.targetX, y: inputState.targetY });

      // keyboard nudge (screen-relative)
      if (mySide) {
        let kdx = 0;
        let kdy = 0;
        if (keys.current.has('a') || keys.current.has('arrowleft')) kdx -= 1;
        if (keys.current.has('d') || keys.current.has('arrowright')) kdx += 1;
        if (keys.current.has('w') || keys.current.has('arrowup')) kdy -= 1;
        if (keys.current.has('s') || keys.current.has('arrowdown')) kdy += 1;
        if (kdx || kdy) {
          const dir = renderer.screenDirToWorld(kdx, kdy);
          target = clampHalf(mySide, { x: target.x + dir.x * PADDLE_SPEED * dt, y: target.y + dir.y * PADDLE_SPEED * dt });
          setTarget(target.x, target.y);
        }
      }

      // smoothed swipe velocity (world ft/s)
      vel.x = vel.x * 0.5 + ((target.x - prevTarget.x) / dt) * 0.5;
      vel.y = vel.y * 0.5 + ((target.y - prevTarget.y) / dt) * 0.5;
      prevTarget.x = target.x;
      prevTarget.y = target.y;
      predicted.current = target;

      const state = getRenderState();
      const phase = state?.phase ?? null;
      const serving = state?.score?.serving ?? null;
      const amServer = !!serving && serving === mySide;
      if (phase !== prevPhase) {
        if (phase === 'serving') serveArmTime = now + 350; // brief arm delay
        prevPhase = phase;
      }

      const speed = Math.hypot(vel.x, vel.y);
      const forward = mySide === 'A' ? vel.x : -vel.x; // +ve = toward opponent
      let flash = 0;

      // --- SERVE: a forward flick launches it ------------------------------
      if (phase === 'serving' && amServer && now > serveArmTime && now - lastServeTime > 600) {
        if (speed > SERVE_MIN_SWIPE && forward > 0) {
          const dir = { x: vel.x / speed, y: vel.y / speed };
          const power = clamp(speed / SWIPE_FULL_SPEED, 0.28, 1);
          commitSwing(dir.x, dir.y, power);
          lastServeTime = now;
          hitFlashTime = now;
        }
      }

      // --- RALLY: screen-space contact = hit -------------------------------
      if (phase === 'rally' && state && mySide && now - lastHitTime > HIT_COOLDOWN_S * 1000) {
        const ball = state.ball;
        const onMySide = mySide === 'A' ? ball.x <= NET_X + CONTACT_REACH : ball.x >= NET_X - CONTACT_REACH;
        const ps = renderer.worldToScreenCss(target.x, target.y);
        const bs = renderer.ballScreenCss(ball);
        const dpx = Math.hypot(ps.x - bs.x, ps.y - bs.y);
        const reachPx = CONTACT_REACH * renderer.pxPerFootCss;
        if (onMySide && dpx <= reachPx && ball.z <= HIT_MAX_HEIGHT) {
          const dir = speed > 5 ? { x: vel.x / speed, y: vel.y / speed } : { x: mySide === 'B' ? -1 : 1, y: 0 };
          const power = clamp(speed / SWIPE_FULL_SPEED, 0.18, 1);
          commitSwing(dir.x, dir.y, power);
          lastHitTime = now;
          hitFlashTime = now;
        }
      }
      if (now - hitFlashTime < 220) flash = 1 - (now - hitFlashTime) / 220;

      // --- send input ------------------------------------------------------
      inputAccum += dt * 1000;
      if (inputAccum >= inputInterval) {
        inputAccum = 0;
        sendInput({
          seq: ++seq.current,
          targetX: target.x,
          targetY: target.y,
          charging: false,
          swingId: inputState.swingId,
          aimX: inputState.aimX,
          aimY: inputState.aimY,
          power: inputState.power,
        });
      }

      // --- draw ------------------------------------------------------------
      if (state) {
        const viz: SwingViz | null = flash > 0
          ? { charging: false, power: 0, aimX: inputState.aimX, aimY: inputState.aimY, flash }
          : null;
        renderer.draw(state, mySide, predicted.current, viz);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      keys.current.clear();
      predicted.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, mySide, active, playerId]);
}
