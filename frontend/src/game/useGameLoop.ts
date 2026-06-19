/**
 * useGameLoop — the client runtime (air-hockey rally model).
 *
 *   1. The paddle ALWAYS follows the cursor / finger 1:1 — it never locks.
 *   2. RALLY: when your moving paddle touches the ball, it is struck. The SPEED
 *      and DIRECTION of your swipe set the shot's power and aim (like air
 *      hockey). Contact is detected on the client (it owns the paddle), so it
 *      feels responsive; the server applies it to the authoritative ball.
 *   3. SERVE: hold to charge power while you keep moving/positioning, release to
 *      serve. The server aims it into the legal diagonal box and clears the net.
 *
 * Mouse and touch share one path. Desktop charges a serve with the left button
 * (or Space); mobile charges with the HOLD-TO-SERVE button. Both swipe to hit.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  CHARGE_TIME_S,
  HIT_COOLDOWN_S,
  HIT_MAX_HEIGHT,
  INPUT_RATE,
  NET_X,
  PADDLE_REACH,
  PADDLE_SPEED,
  SWIPE_FULL_SPEED,
  WORLD_MAX_X,
  WORLD_MAX_Y,
  WORLD_MIN_X,
  WORLD_MIN_Y,
} from '../shared/constants';
import type { Side } from '../shared/types';
import { CourtRenderer, type SwingViz } from './renderer';
import { getRenderState } from './netState';
import { inputState, setPointer, setTarget, setWantCharge, commitSwing, resetInput } from './input';
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
    let charging = false; // charging a SERVE
    let chargeStart = 0;
    let lastHitTime = -9999;
    let hitFlashTime = -9999;

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
    const onPointerDown = (e: PointerEvent) => {
      moveTo(localPoint(e.clientX, e.clientY));
      if (e.pointerType === 'mouse' && e.button === 0) setWantCharge(true);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') setWantCharge(false);
      else {
        vel.x = 0; // finger lifted: no lingering swipe
        vel.y = 0;
      }
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    // -- keyboard (optional): WASD nudge, Space charges a serve ------------
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.current.add(k);
      if (k === ' ') {
        setWantCharge(true);
        e.preventDefault();
      }
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.current.delete(k);
      if (k === ' ') setWantCharge(false);
    };
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

      const target = clampHalf(mySide ?? 'A', { x: inputState.targetX, y: inputState.targetY });

      // Smoothed paddle (cursor) velocity — this is the "swipe".
      const instVx = (target.x - prevTarget.x) / dt;
      const instVy = (target.y - prevTarget.y) / dt;
      vel.x = vel.x * 0.55 + instVx * 0.45;
      vel.y = vel.y * 0.55 + instVy * 0.45;
      prevTarget.x = target.x;
      prevTarget.y = target.y;
      predicted.current = target;

      // --- keyboard nudge (screen-relative to match the rotated view) ------
      if (mySide) {
        let kdx = 0;
        let kdy = 0;
        if (keys.current.has('a') || keys.current.has('arrowleft')) kdx -= 1;
        if (keys.current.has('d') || keys.current.has('arrowright')) kdx += 1;
        if (keys.current.has('w') || keys.current.has('arrowup')) kdy -= 1;
        if (keys.current.has('s') || keys.current.has('arrowdown')) kdy += 1;
        if (kdx || kdy) {
          const dir = renderer.screenDirToWorld(kdx, kdy);
          const c = clampHalf(mySide, {
            x: target.x + dir.x * PADDLE_SPEED * dt,
            y: target.y + dir.y * PADDLE_SPEED * dt,
          });
          setTarget(c.x, c.y);
          predicted.current = c;
        }
      }

      const state = getRenderState();
      const phase = state?.phase ?? null;
      const serving = state?.score?.serving ?? null;
      const amServer = !!serving && serving === mySide;

      // --- SERVE: charge while still free to move; release to serve --------
      if (phase === 'serving' && amServer) {
        if (inputState.wantCharge && !charging) {
          charging = true;
          inputState.charging = true;
          chargeStart = now;
        } else if (!inputState.wantCharge && charging) {
          charging = false;
          inputState.charging = false;
          const power = clamp((now - chargeStart) / (CHARGE_TIME_S * 1000), 0.12, 1);
          commitSwing(mySide === 'B' ? -1 : 1, 0, power);
        }
      } else if (charging) {
        charging = false;
        inputState.charging = false;
      }
      const servePower = charging ? clamp((now - chargeStart) / (CHARGE_TIME_S * 1000), 0.12, 1) : 0;

      // --- RALLY: contact + swipe = hit (air hockey) ----------------------
      if (phase === 'rally' && state && mySide && now - lastHitTime > HIT_COOLDOWN_S * 1000) {
        const ball = state.ball;
        const onMySide = mySide === 'A' ? ball.x <= NET_X + PADDLE_REACH : ball.x >= NET_X - PADDLE_REACH;
        const d = Math.hypot(ball.x - (predicted.current?.x ?? target.x), ball.y - (predicted.current?.y ?? target.y));
        if (onMySide && d <= PADDLE_REACH && ball.z <= HIT_MAX_HEIGHT) {
          const speed = Math.hypot(vel.x, vel.y);
          const dir = speed > 6 ? { x: vel.x / speed, y: vel.y / speed } : { x: mySide === 'B' ? -1 : 1, y: 0 };
          const power = clamp(speed / SWIPE_FULL_SPEED, 0, 1);
          commitSwing(dir.x, dir.y, power);
          lastHitTime = now;
          hitFlashTime = now;
        }
      }
      const flash = now - hitFlashTime < 220 ? 1 - (now - hitFlashTime) / 220 : 0;

      // --- send input at a fixed rate -------------------------------------
      inputAccum += dt * 1000;
      if (inputAccum >= inputInterval) {
        inputAccum = 0;
        const p = predicted.current ?? target;
        sendInput({
          seq: ++seq.current,
          targetX: p.x,
          targetY: p.y,
          charging: inputState.charging,
          swingId: inputState.swingId,
          aimX: inputState.aimX,
          aimY: inputState.aimY,
          power: inputState.power,
        });
      }

      // --- draw ------------------------------------------------------------
      if (state) {
        let viz: SwingViz | null = null;
        if (charging) {
          viz = { charging: true, power: servePower, aimX: mySide === 'B' ? -1 : 1, aimY: 0, flash: 0 };
        } else if (flash > 0) {
          viz = { charging: false, power: 0, aimX: inputState.aimX, aimY: inputState.aimY, flash };
        }
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
