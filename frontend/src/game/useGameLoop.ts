/**
 * useGameLoop — the heart of the client runtime.
 *
 * Responsibilities (kept deliberately separate from rendering and netcode):
 *   1. Run a requestAnimationFrame loop while the game screen is mounted.
 *   2. At INPUT_RATE, sample the current intent and send it to the server,
 *      tagged with a monotonic sequence number.
 *   3. PREDICT the local player's own paddle immediately so it feels instant,
 *      then RECONCILE against the latest authoritative position so prediction
 *      can never drift away from the server's truth.
 *   4. Ask netState for an interpolated world snapshot and hand everything to
 *      the renderer.
 *
 * Everything the player does not control (the ball, the opponent's paddle, the
 * score) comes straight from the interpolated authoritative feed — we never
 * invent those.
 */
import { useEffect, useRef, type RefObject } from 'react';
import {
  INPUT_RATE,
  PADDLE_SPEED,
  COURT_WIDTH,
  NET_X,
  WORLD_MAX_X,
  WORLD_MIN_X,
} from '../shared/constants';
import type { Side } from '../shared/types';
import { CourtRenderer } from './renderer';
import { getRenderState, latestPaddle } from './netState';
import { readIntent, startInput, stopInput } from './input';
import { sendInput } from '../net/socket';
import { useStore } from '../state/store';

interface Vec {
  x: number;
  y: number;
}

/** Clamp the predicted paddle to the half of the court it is allowed to defend. */
function clampToHalf(side: Side, p: Vec): Vec {
  const margin = 0.5;
  const minX = side === 'A' ? WORLD_MIN_X + margin : NET_X + margin;
  const maxX = side === 'A' ? NET_X - margin : WORLD_MAX_X - margin;
  return {
    x: Math.max(minX, Math.min(maxX, p.x)),
    y: Math.max(margin, Math.min(COURT_WIDTH - margin, p.y)),
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const renderer = new CourtRenderer(canvas);
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    startInput();

    let raf = 0;
    let lastFrame = performance.now();
    let inputAccum = 0;
    const inputInterval = 1000 / INPUT_RATE;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;

      const intent = readIntent();

      // --- send input at a fixed rate (decoupled from the render framerate) ---
      inputAccum += dt * 1000;
      if (inputAccum >= inputInterval) {
        inputAccum = 0;
        sendInput({
          seq: ++seq.current,
          dirX: intent.dirX,
          dirY: intent.dirY,
          hit: intent.hit,
          serve: intent.serve,
          aimY: intent.aimY,
        });
      }

      // --- predict + reconcile the local paddle ---------------------------
      if (mySide) {
        const authoritative = latestPaddle(mySide);
        if (!predicted.current && authoritative) {
          predicted.current = { ...authoritative };
        }
        if (predicted.current) {
          // Integrate local intent for an instant-feeling response.
          predicted.current = clampToHalf(mySide, {
            x: predicted.current.x + intent.dirX * PADDLE_SPEED * dt,
            y: predicted.current.y + intent.dirY * PADDLE_SPEED * dt,
          });
          // Gently pull prediction toward the server's truth (reconciliation).
          if (authoritative) {
            predicted.current.x += (authoritative.x - predicted.current.x) * 0.12;
            predicted.current.y += (authoritative.y - predicted.current.y) * 0.12;
          }
        }
      }

      const state = getRenderState();
      if (state) renderer.draw(state, mySide, predicted.current);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      stopInput();
      predicted.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, mySide, active, playerId]);
}
