import { io, type Socket } from 'socket.io-client';
import type { Dir, Envelope, SceneId } from '../../shared/protocol.js';
import { applyEvent, createRoomState, type RoomState } from '../../shared/state.js';

export interface LiveMove {
  playerId: string;
  x: number;
  y: number;
  dir: Dir;
  scene: SceneId;
}

export const store = {
  me: '',
  roomId: '',
  state: createRoomState('main') as RoomState,
  uiBlocking: false,
  spectator: false,
};

type Listener<T> = (v: T) => void;
const eventListeners: Listener<Envelope>[] = [];
const snapshotListeners: Listener<RoomState>[] = [];
const liveListeners: Listener<LiveMove>[] = [];

export const onEvent = (fn: Listener<Envelope>) => eventListeners.push(fn);
export const onSnapshot = (fn: Listener<RoomState>) => snapshotListeners.push(fn);
export const onLive = (fn: Listener<LiveMove>) => liveListeners.push(fn);

export const socket: Socket = io({ transports: ['websocket', 'polling'] });

socket.on('welcome', (w: { playerId: string }) => (store.me = w.playerId));
socket.on('snapshot', (s: RoomState) => {
  store.state = s;
  snapshotListeners.forEach((f) => f(s));
});
socket.on('event', (e: Envelope) => {
  applyEvent(store.state, e);
  eventListeners.forEach((f) => f(e));
});
socket.on('live', (m: LiveMove) => liveListeners.forEach((f) => f(m)));

export const command = (type: string, payload: unknown = {}) => socket.emit('command', type, payload);

if (import.meta.env.DEV) Object.assign(window, { __store: store, __cmd: command });
