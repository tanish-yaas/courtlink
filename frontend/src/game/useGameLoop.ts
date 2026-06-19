/**
 * useGameLoop — the client runtime.
 *
 *   1. RAF render loop while the game screen is mounted.
 *   2. Pointer (mouse/finger) over the court drives the paddle TARGET 1:1.
 *   3. Hold to charge a swing (power ramps); while held the paddle locks and the
 *      pointer drag becomes the slingshot AIM. Release fires (new swingId).
 *   4. Input is sent at INPUT_RATE; the own paddle is predicted locally and the
 *      server reconciles via the authoritative feed.
 *
 * Mouse and touch share one path: both feed `inputState`. Desktop charges from
 * the left button / Space; mobile charges from the HOLD-TO-HIT button.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  CHARGE_TIME_S,
  INPUT_RATE,
  NET_X,
  PADDLE_SPEED,
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

    // Seed pointer + target at the player's start so nothing jumps.
    const start = clampHalf(mySide ?? 'A', { x: mySide === 'B' ? 37 : 7, y: 10 });
    setTarget(start.x, start.y);
    predicted.current = { ...start };

    let charging = false;
    let chargeStart = 0;
    const chargeStartScreen: Vec = { x: 0, y: 0 };

    const localPoint = (clientX: number, clientY: number): Vec => {
      const r = canvas.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    // -- pointer (mouse + touch via Pointer Events) ------------------------
    const onPointerMove = (e: PointerEvent) => {
      const p = localPoint(e.clientX, e.clientY);
      setPointer(p.x, p.y);
      if (!inputState.wantCharge) {
        const w = renderer.screenToWorld(p.x, p.y);
        const c = clampHalf(mySide ?? 'A', w);
        setTarget(c.x, c.y);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const p = localPoint(e.clientX, e.clientY);
      setPointer(p.x, p.y);
      if (e.pointerType === 'mouse') {
        if (e.button === 0) setWantCharge(true);
      } else {
        // touch: move the paddle to the finger (charge comes from the HIT button)
        const w = renderer.screenToWorld(p.x, p.y);
        const c = clampHalf(mySide ?? 'A', w);
        if (!inputState.wantCharge) setTarget(c.x, c.y);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') setWantCharge(false);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    // -- keyboard (optional): WASD nudges, Space charges -------------------
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

    const aimNow = (): Vec => {
      const dx = inputState.pointerX - chargeStartScreen.x;
      const dy = inputState.pointerY - chargeStartScreen.y;
      if (Math.hypot(dx, dy) < 8) return { x: mySide === 'B' ? -1 : 1, y: 0 };
      return renderer.screenDirToWorld(dx, dy);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // --- reconcile charge state (works for mouse, touch button, Space) ---
      if (inputState.wantCharge && !charging) {
        charging = true;
        inputState.charging = true;
        chargeStart = now;
        chargeStartScreen.x = inputState.pointerX;
        chargeStartScreen.y = inputState.pointerY;
      } else if (!inputState.wantCharge && charging) {
        charging = false;
        inputState.charging = false;
        const aim = aimNow();
        const power = clamp((now - chargeStart) / (CHARGE_TIME_S * 1000), 0.12, 1);
        commitSwing(aim.x, aim.y, power);
      }
      const power = charging ? clamp((now - chargeStart) / (CHARGE_TIME_S * 1000), 0.12, 1) : 0;

      // --- keyboard nudge (screen-relative so it matches the rotated view) ---
      if (!charging && mySide) {
        let kdx = 0;
        let kdy = 0;
        if (keys.current.has('a') || keys.current.has('arrowleft')) kdx -= 1;
        if (keys.current.has('d') || keys.current.has('arrowright')) kdx += 1;
        if (keys.current.has('w') || keys.current.has('arrowup')) kdy -= 1; // up the screen
        if (keys.current.has('s') || keys.current.has('arrowdown')) kdy += 1;
        if (kdx || kdy) {
          const dir = renderer.screenDirToWorld(kdx, kdy);
          const c = clampHalf(mySide, {
            x: inputState.targetX + dir.x * PADDLE_SPEED * dt,
            y: inputState.targetY + dir.y * PADDLE_SPEED * dt,
          });
          setTarget(c.x, c.y);
        }
      }

      // --- predicted own paddle = clamped target (1:1) ---------------------
      predicted.current = clampHalf(mySide ?? 'A', { x: inputState.targetX, y: inputState.targetY });

      // --- send input at a fixed rate -------------------------------------
      inputAccum += dt * 1000;
      if (inputAccum >= inputInterval) {
        inputAccum = 0;
        sendInput({
          seq: ++seq.current,
          targetX: predicted.current.x,
          targetY: predicted.current.y,
          charging: inputState.charging,
          swingId: inputState.swingId,
          aimX: inputState.aimX,
          aimY: inputState.aimY,
          power: inputState.power,
        });
      }

      // --- draw ------------------------------------------------------------
      const state = getRenderState();
      if (state) {
        const viz: SwingViz | null = charging
          ? { charging: true, power, aimX: aimNow().x, aimY: aimNow().y }
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
