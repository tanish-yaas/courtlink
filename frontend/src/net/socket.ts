/**
 * Networking layer (client side).
 *
 * Owns the single Socket.IO connection, persists the player's identity so a
 * refresh reconnects into the same seat, measures ping, and funnels server
 * messages into the store. UI components call the exported action functions;
 * they never touch the socket directly.
 */
import { io, type Socket } from 'socket.io-client';
import {
  NetEvents,
  type GameEvent,
  type GameSnapshot,
  type InputReq,
  type JoinRoomAck,
  type RoomState,
  type RuleConfig,
  type Side,
} from '../shared/types';
import { useStore } from '../state/store';
import { pushSnapshot } from '../game/netState';

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  'http://localhost:8080';

const LS_KEY = 'courtlink.identity';

interface Identity {
  playerId: string;
  token: string;
  roomId: string;
  name: string;
}

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}
function saveIdentity(id: Identity) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(id));
  } catch {
    /* private mode — ignore */
  }
}
export function clearIdentity() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

let socket: Socket | null = null;

function ensureSocket(): Socket {
  if (socket) return socket;
  const s = useStore.getState();
  s.setConnection('connecting');

  socket = io(BACKEND_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
  });

  socket.on('connect', () => {
    useStore.getState().setConnection('connected');
    measurePing();
  });
  socket.on('disconnect', () => useStore.getState().setConnection('reconnecting'));
  socket.io.on('reconnect', () => {
    // Re-claim our seat after a transport reconnect.
    const id = loadIdentity();
    if (id) rejoin(id);
  });

  socket.on(NetEvents.RoomState, (room: RoomState) => {
    useStore.getState().setRoom(room);
  });
  socket.on(NetEvents.Snapshot, (snap: GameSnapshot) => {
    useStore.getState().setSnapshot(snap);
    pushSnapshot(snap);
  });
  socket.on(NetEvents.Event, (e: GameEvent) => {
    useStore.getState().pushEvent(e);
  });
  socket.on(NetEvents.ErrorMsg, (msg: string) => {
    useStore.getState().setError(typeof msg === 'string' ? msg : 'Server error');
  });

  return socket;
}

function measurePing() {
  if (!socket) return;
  const start = performance.now();
  // Socket.IO has a built-in ping, but a tiny volatile round-trip is simplest.
  socket.timeout(4000).emit('ping:client', () => {
    useStore.getState().setPing(Math.round(performance.now() - start));
  });
  setTimeout(measurePing, 3000);
}

// --- actions ---------------------------------------------------------------
export function createRoom(name: string, rules?: Partial<RuleConfig>) {
  const s = ensureSocket();
  useStore.getState().setIdentity({ name });
  s.emit(NetEvents.CreateRoom, { name, rules }, (ack: JoinRoomAck) => {
    if (!ack.ok || !ack.roomId) {
      useStore.getState().setError(ack.error ?? 'Could not create court');
      return;
    }
    persistAndEnter(ack, name);
  });
}

export function joinRoom(roomId: string, name: string) {
  const s = ensureSocket();
  const code = roomId.trim().toUpperCase();
  useStore.getState().setIdentity({ name });
  s.emit(NetEvents.JoinRoom, { roomId: code, name }, (ack: JoinRoomAck) => {
    if (!ack.ok || !ack.roomId) {
      useStore.getState().setError(ack.error ?? 'Could not join court');
      return;
    }
    persistAndEnter(ack, name);
  });
}

/** Reconnect into a previously-held seat (used on refresh / transport reconnect). */
export function rejoin(id: Identity) {
  const s = ensureSocket();
  s.emit(
    NetEvents.JoinRoom,
    { roomId: id.roomId, name: id.name, playerId: id.playerId, token: id.token },
    (ack: JoinRoomAck) => {
      if (ack.ok && ack.roomId) persistAndEnter(ack, id.name);
    },
  );
}

function persistAndEnter(ack: JoinRoomAck, name: string) {
  const id: Identity = {
    playerId: ack.playerId!,
    token: ack.token!,
    roomId: ack.roomId!,
    name,
  };
  saveIdentity(id);
  useStore.getState().setIdentity({
    playerId: id.playerId,
    token: id.token,
    roomId: id.roomId,
    isHost: !!ack.isHost,
    name,
  });
  useStore.getState().setError(null);
  // Move to side selection if we're still in the lobby.
  const screen = useStore.getState().screen;
  if (screen === 'landing' || screen === 'create' || screen === 'join') {
    useStore.getState().setScreen('side');
  }
}

export function selectSide(side: Side | null) {
  ensureSocket().emit(NetEvents.SelectSide, { side });
}
export function setReady(ready: boolean) {
  ensureSocket().emit(NetEvents.Ready, { ready });
}
export function configure(rules: Partial<RuleConfig>) {
  ensureSocket().emit(NetEvents.Configure, { rules });
}
export function rematch() {
  ensureSocket().emit(NetEvents.Rematch);
}
export function sendInput(input: InputReq) {
  socket?.emit(NetEvents.Input, input);
}
export function leaveRoom() {
  socket?.emit(NetEvents.Leave);
  clearIdentity();
  useStore.getState().reset();
}

/** Called once at startup to attempt seat recovery from a prior session. */
export function tryAutoReconnect() {
  const id = loadIdentity();
  if (id) rejoin(id);
}

export { BACKEND_URL };
