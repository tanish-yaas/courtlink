import { create } from 'zustand';
import type { GameEvent, GameSnapshot, RoomState, Side } from '../shared/types';

export type Screen =
  | 'landing'
  | 'create'
  | 'join'
  | 'side'
  | 'waiting'
  | 'game';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface Toast {
  id: number;
  text: string;
  tone: 'gold' | 'fault' | 'point';
}

interface AppState {
  screen: Screen;
  connection: ConnectionStatus;
  error: string | null;
  pingMs: number | null;

  // identity (persisted to localStorage by the socket layer)
  playerId: string | null;
  token: string | null;
  roomId: string | null;
  isHost: boolean;
  name: string;

  room: RoomState | null;
  snapshot: GameSnapshot | null;
  toast: Toast | null;

  // setters used by the networking layer
  setScreen: (s: Screen) => void;
  setConnection: (c: ConnectionStatus) => void;
  setError: (e: string | null) => void;
  setPing: (p: number) => void;
  setIdentity: (id: Partial<Pick<AppState, 'playerId' | 'token' | 'roomId' | 'isHost' | 'name'>>) => void;
  setRoom: (r: RoomState) => void;
  setSnapshot: (s: GameSnapshot) => void;
  pushEvent: (e: GameEvent) => void;
  reset: () => void;
}

let toastSeq = 0;

const faultText: Record<string, string> = {
  net: 'Into the net',
  out: 'Out',
  doubleBounce: 'Double bounce',
  kitchenVolley: 'Kitchen volley',
  twoBounceViolation: 'Two-bounce rule',
  illegalServe: 'Illegal serve',
};

export const useStore = create<AppState>((set, get) => ({
  screen: 'landing',
  connection: 'idle',
  error: null,
  pingMs: null,
  playerId: null,
  token: null,
  roomId: null,
  isHost: false,
  name: '',
  room: null,
  snapshot: null,
  toast: null,

  setScreen: (screen) => set({ screen }),
  setConnection: (connection) => set({ connection }),
  setError: (error) => set({ error }),
  setPing: (pingMs) => set({ pingMs }),
  setIdentity: (id) => set(id),
  setRoom: (room) => set({ room }),
  setSnapshot: (snapshot) => set({ snapshot }),

  pushEvent: (e) => {
    let text = '';
    let tone: Toast['tone'] = 'gold';
    if (e.type === 'fault' && e.reason) {
      text = faultText[e.reason] ?? 'Fault';
      tone = 'fault';
    } else if (e.type === 'point' && e.side) {
      text = `Point — Team ${e.side}`;
      tone = 'point';
    } else if (e.type === 'sideout' && e.side) {
      text = `Side out — Team ${e.side} to serve`;
      tone = 'gold';
    } else if (e.type === 'matchOver' && e.winner) {
      text = `Team ${e.winner} wins`;
      tone = 'point';
    }
    if (text) set({ toast: { id: ++toastSeq, text, tone } });
    void get;
  },

  reset: () =>
    set({
      screen: 'landing',
      room: null,
      snapshot: null,
      toast: null,
      isHost: false,
      roomId: null,
      error: null,
    }),
}));

/** Convenience selector: which side is the local player seated on? */
export function mySide(): Side | null {
  const { room, playerId } = useStore.getState();
  return room?.players.find((p) => p.playerId === playerId)?.side ?? null;
}
