/**
 * Solo mode — a fully offline match against the AI.
 *
 * Runs the real GameSim locally (no server, no socket): each frame it applies
 * your input (routed here by sendInput) and the AI's input, steps the sim, and
 * publishes snapshots/events into the same store + interpolation buffer the
 * online client already renders from. The Game screen doesn't know the
 * difference — it just sees a "room" with you and the computer.
 */
import { DEFAULT_RULES, SNAPSHOT_RATE } from '../shared/constants';
import type { InputReq, RoomState, Side } from '../shared/types';
import { GameSim } from '../sim/GameSim';
import { AIController, type Difficulty } from './ai';
import { pushSnapshot, clearBuffer } from './netState';
import { useStore } from '../state/store';

let active = false;
let sim: GameSim | null = null;
let ai: AIController | null = null;
let humanInput: InputReq | null = null;
let difficulty: Difficulty = 'medium';
const HUMAN: Side = 'A';
const CPU: Side = 'B';

let raf = 0;
let last = 0;
let snapAccum = 0;

export function soloActive() {
  return active;
}

/** Routed here from sendInput() when a solo match is running. */
export function soloInput(input: InputReq) {
  humanInput = input;
}

function label(d: Difficulty) {
  return d === 'easy' ? 'Easy' : d === 'hard' ? 'Hard' : 'Medium';
}

function makeRoom(): RoomState {
  return {
    roomId: 'SOLO',
    phase: 'countdown',
    rules: { ...DEFAULT_RULES },
    players: [
      { playerId: 'you', name: 'You', side: HUMAN, ready: true, connected: true },
      { playerId: 'cpu', name: `Computer · ${label(difficulty)}`, side: CPU, ready: true, connected: true },
    ],
    hostId: 'you',
  };
}

export function startSolo(diff: Difficulty) {
  stopSolo();
  difficulty = diff;
  active = true;
  sim = new GameSim({ ...DEFAULT_RULES });
  ai = new AIController(CPU, diff);
  humanInput = null;
  clearBuffer();

  const st = useStore.getState();
  st.setIdentity({ playerId: 'you', token: null, roomId: 'SOLO', isHost: true, name: 'You' });
  st.setRoom(makeRoom());
  st.setConnection('connected');
  st.setPing(0);
  st.setSnapshot(sim.snapshot());
  st.setScreen('game');

  sim.startMatch();
  last = performance.now();
  snapAccum = 0;
  raf = requestAnimationFrame(loop);
}

export function restartSolo() {
  if (!sim) {
    startSolo(difficulty);
    return;
  }
  clearBuffer();
  sim.startMatch();
  useStore.getState().setScreen('game');
}

export function stopSolo() {
  active = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  sim = null;
  ai = null;
  humanInput = null;
}

function loop(now: number) {
  if (!active || !sim || !ai) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (humanInput) sim.applyInput(HUMAN, humanInput);
  sim.applyInput(CPU, ai.update(sim, dt));
  sim.step(dt);

  for (const e of sim.takeEvents()) useStore.getState().pushEvent(e);

  snapAccum += dt * 1000;
  if (snapAccum >= 1000 / SNAPSHOT_RATE) {
    snapAccum = 0;
    const snap = sim.snapshot();
    useStore.getState().setSnapshot(snap);
    pushSnapshot(snap);
  }

  raf = requestAnimationFrame(loop);
}
