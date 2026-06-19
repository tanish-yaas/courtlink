/**
 * CourtLink Pickleball — shared types (network protocol + state shapes).
 *
 * Canonical contract used by both client and server. See constants.ts header
 * for the sync note and coordinate system.
 */
import type { RuleConfig, ScoringMode } from './constants';

export type Side = 'A' | 'B';
export type SeatId = Side; // singles: one seat per side

/** High-level lifecycle of a room/match. */
export type Phase =
  | 'lobby' // players joining, picking sides, readying up
  | 'countdown' // brief cinematic countdown before serve
  | 'serving' // server holds the ball, waiting to serve
  | 'rally' // ball is live
  | 'pointOver' // a point just resolved; short pause
  | 'paused' // a player disconnected; awaiting reconnect
  | 'matchOver'; // someone won the match

/** Which service court a serve originates from / targets. */
export type ServiceCourt = 'right' | 'left';

// ---------------------------------------------------------------------------
// Lobby / room state (sent on the "room:state" channel)
// ---------------------------------------------------------------------------
export interface PublicPlayer {
  playerId: string; // stable id (persisted in localStorage for reconnects)
  name: string;
  side: Side | null; // chosen side, or null if still spectating/undecided
  ready: boolean;
  connected: boolean;
}

export interface RoomState {
  roomId: string;
  phase: Phase;
  rules: RuleConfig;
  players: PublicPlayer[];
  hostId: string; // who created the room (can start/configure)
}

// ---------------------------------------------------------------------------
// Live game snapshot (sent on the "snapshot" channel, ~SNAPSHOT_RATE/s)
// The server is authoritative for everything here.
// ---------------------------------------------------------------------------
export interface BallSnapshot {
  x: number;
  y: number;
  z: number; // height above court
  vx: number;
  vy: number;
  vz: number;
}

export interface PaddleSnapshot {
  side: Side;
  x: number;
  y: number;
}

export interface ScoreState {
  A: number;
  B: number;
  serving: Side; // which side currently serves
  serverNumber: 1 | 2; // doubles 2nd-server logic (always 1 in singles)
  serviceCourt: ServiceCourt; // right (even) or left (odd) based on server score
}

export interface GameSnapshot {
  tick: number;
  serverTimeMs: number;
  phase: Phase;
  ball: BallSnapshot;
  paddles: PaddleSnapshot[];
  score: ScoreState;
  countdown?: number; // seconds remaining when phase === 'countdown'
  /** Per-player last input sequence the server has applied (for reconciliation). */
  ack: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Discrete game events (sent on the "event" channel) — for HUD + sound cues.
// ---------------------------------------------------------------------------
export type GameEventType =
  | 'serve'
  | 'hit'
  | 'bounce'
  | 'fault'
  | 'point'
  | 'sideout'
  | 'matchOver';

export type FaultReason =
  | 'net'
  | 'out'
  | 'doubleBounce'
  | 'kitchenVolley'
  | 'twoBounceViolation'
  | 'illegalServe';

export interface GameEvent {
  type: GameEventType;
  side?: Side; // the side the event concerns (e.g. who faulted, who scored)
  reason?: FaultReason;
  winner?: Side; // for matchOver
  message?: string; // short human-readable HUD text
}

// ---------------------------------------------------------------------------
// Client -> Server message payloads (Socket.IO event names in NetEvents below)
// ---------------------------------------------------------------------------
export interface CreateRoomReq {
  name: string;
  rules?: Partial<RuleConfig>;
}
export interface JoinRoomReq {
  roomId: string;
  name: string;
  playerId?: string; // present when reconnecting
  token?: string; // seat token, sent back when reconnecting
}
export interface JoinRoomAck {
  ok: boolean;
  error?: string;
  roomId?: string;
  playerId?: string;
  token?: string; // opaque seat token used for reconnect auth
  isHost?: boolean;
}
export interface SelectSideReq {
  side: Side | null;
}
export interface ReadyReq {
  ready: boolean;
}
export interface ConfigureReq {
  rules: Partial<RuleConfig>;
}

/**
 * Per-frame player intent. The local player drives their paddle by POSITION
 * (mouse/finger = 1:1 cursor), and swings are charge-and-release:
 *   - `targetX/targetY`: desired paddle position in WORLD coords (server clamps
 *     it to the player's own half).
 *   - `charging`: the player is holding to charge a swing (paddle is locked).
 *   - `swingId`: increments by 1 on every release/fire. The server performs a
 *     swing exactly once per new id (resent each frame for loss tolerance).
 *   - `aimX/aimY`: WORLD-space aim direction at release (already un-rotated by
 *     the client, so the server reads it directly).
 *   - `power`: 0..1 charge level at release.
 */
export interface InputReq {
  seq: number; // monotonic per-client sequence number
  targetX: number;
  targetY: number;
  charging: boolean;
  swingId: number;
  aimX: number;
  aimY: number;
  power: number;
}

// ---------------------------------------------------------------------------
// Socket.IO event-name constants (avoid magic strings on both sides).
// ---------------------------------------------------------------------------
export const NetEvents = {
  // client -> server
  CreateRoom: 'room:create',
  JoinRoom: 'room:join',
  SelectSide: 'room:selectSide',
  Ready: 'room:ready',
  Configure: 'room:configure',
  Rematch: 'room:rematch',
  Leave: 'room:leave',
  Input: 'input',
  // server -> client
  RoomState: 'room:state',
  Snapshot: 'snapshot',
  Event: 'event',
  ErrorMsg: 'error',
} as const;

export type { RuleConfig, ScoringMode };
