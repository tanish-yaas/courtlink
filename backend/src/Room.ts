/**
 * Room — one match between (up to) two seats.
 *
 * Responsibilities:
 *  - Own the player roster, side selection, and ready state (the lobby).
 *  - Own the authoritative GameSim and run its fixed-timestep loop.
 *  - Broadcast room state (lobby changes) and snapshots/events (live play).
 *  - Survive brief disconnects: a seat is held for RECONNECT_GRACE_MS so a
 *    refresh or a dropped phone reconnects into the same seat.
 *
 * What runs WHERE:
 *  - Server (here): physics, scoring, faults, serve validity, room state.
 *  - Client: input capture, prediction of its own paddle, interpolation.
 */
import type { Server } from 'socket.io';
import {
  DEFAULT_RULES,
  RECONNECT_GRACE_MS,
  SNAPSHOT_RATE,
  TICK_RATE,
  type RuleConfig,
} from './shared/constants';
import {
  NetEvents,
  type PublicPlayer,
  type RoomState,
  type Side,
} from './shared/types';
import { GameSim } from './sim/GameSim';

interface PlayerRecord {
  playerId: string;
  token: string;
  name: string;
  socketId: string | null;
  side: Side | null;
  ready: boolean;
  connected: boolean;
  graceTimer?: NodeJS.Timeout;
}

const dtSeconds = 1 / TICK_RATE;
const snapshotEvery = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));

export class Room {
  readonly id: string;
  hostId: string | null = null;
  rules: RuleConfig;
  private players = new Map<string, PlayerRecord>();
  private sim: GameSim;
  private loop: NodeJS.Timeout | null = null;
  private frame = 0;

  constructor(id: string, private io: Server, rules?: Partial<RuleConfig>) {
    this.id = id;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.sim = new GameSim(this.rules);
  }

  get isEmpty(): boolean {
    return [...this.players.values()].every((p) => !p.connected);
  }

  // -- roster --------------------------------------------------------------
  addOrReconnect(args: {
    playerId: string;
    token: string;
    name: string;
    socketId: string;
  }): PlayerRecord {
    const existing = this.players.get(args.playerId);
    if (existing) {
      // Reconnect path: only accept a matching seat token.
      if (existing.token !== args.token) {
        // Token mismatch -> treat as a fresh spectator with a new identity.
      } else {
        if (existing.graceTimer) clearTimeout(existing.graceTimer);
        existing.socketId = args.socketId;
        existing.connected = true;
        existing.name = args.name || existing.name;
        this.maybeResume();
        this.broadcastState();
        return existing;
      }
    }
    const rec: PlayerRecord = {
      playerId: args.playerId,
      token: args.token,
      name: args.name || 'Player',
      socketId: args.socketId,
      side: null,
      ready: false,
      connected: true,
    };
    this.players.set(args.playerId, rec);
    if (!this.hostId) this.hostId = args.playerId;
    this.broadcastState();
    return rec;
  }

  selectSide(playerId: string, side: Side | null) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (side && this.seatTakenBy(side, playerId)) return; // seat occupied
    p.side = side;
    p.ready = false;
    this.broadcastState();
  }

  setReady(playerId: string, ready: boolean) {
    const p = this.players.get(playerId);
    if (!p || !p.side) return;
    p.ready = ready;
    this.broadcastState();
    this.maybeStart();
  }

  configure(playerId: string, rules: Partial<RuleConfig>) {
    if (playerId !== this.hostId) return;
    this.rules = { ...this.rules, ...rules };
    this.sim.rules = this.rules;
    this.broadcastState();
  }

  rematch(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.ready = true;
    const seated = this.seatedPlayers();
    if (seated.length === 2 && seated.every((s) => s.ready)) {
      seated.forEach((s) => (s.ready = false));
      this.sim.rematch();
      this.broadcastState();
    } else {
      this.broadcastState();
    }
  }

  handleDisconnect(socketId: string) {
    const p = [...this.players.values()].find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.ready = false;
    this.sim.pause();
    this.broadcastState();
    p.graceTimer = setTimeout(() => {
      // Grace expired: free the seat entirely.
      this.players.delete(p.playerId);
      if (this.hostId === p.playerId) {
        this.hostId = this.seatedPlayers()[0]?.playerId ?? [...this.players.keys()][0] ?? null;
      }
      this.broadcastState();
    }, RECONNECT_GRACE_MS);
  }

  applyInput(playerId: string, input: import('./shared/types').InputReq) {
    const p = this.players.get(playerId);
    if (!p || !p.side) return;
    this.sim.applyInput(p.side, input);
  }

  // -- match flow ----------------------------------------------------------
  private maybeStart() {
    if (this.sim.phase !== 'lobby') return;
    const seated = this.seatedPlayers();
    if (seated.length === 2 && seated.every((s) => s.ready && s.connected)) {
      this.sim.startMatch();
      this.startLoop();
      this.broadcastState();
    }
  }

  private maybeResume() {
    const seated = this.seatedPlayers();
    if (this.sim.phase === 'paused' && seated.length === 2 && seated.every((s) => s.connected)) {
      this.sim.resume();
    }
  }

  private startLoop() {
    if (this.loop) return;
    this.loop = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  stopLoop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private tick() {
    this.sim.step(dtSeconds);
    const events = this.sim.takeEvents();
    if (events.length) {
      for (const e of events) this.io.to(this.id).emit(NetEvents.Event, e);
    }
    this.frame++;
    if (this.frame % snapshotEvery === 0) {
      this.io.to(this.id).emit(NetEvents.Snapshot, this.sim.snapshot());
    }
  }

  // -- helpers -------------------------------------------------------------
  private seatTakenBy(side: Side, exceptId: string): boolean {
    return [...this.players.values()].some((p) => p.side === side && p.playerId !== exceptId);
  }

  private seatedPlayers(): PlayerRecord[] {
    return [...this.players.values()].filter((p) => p.side);
  }

  state(): RoomState {
    const players: PublicPlayer[] = [...this.players.values()].map((p) => ({
      playerId: p.playerId,
      name: p.name,
      side: p.side,
      ready: p.ready,
      connected: p.connected,
    }));
    return {
      roomId: this.id,
      phase: this.sim.phase,
      rules: this.rules,
      players,
      hostId: this.hostId ?? '',
    };
  }

  private broadcastState() {
    this.io.to(this.id).emit(NetEvents.RoomState, this.state());
  }
}
