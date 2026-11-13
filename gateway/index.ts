import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import express from 'express';
import { Server as IoServer, type Socket } from 'socket.io';
import type { Broker } from '../broker/index.js';
import { readReplay } from '../services/replay.js';
import {
  CLASS_IDS,
  NPC_IDS,
  TOPIC_KEYS,
  envelope,
  isCommandType,
  topicName,
  type CommandType,
  type Dir,
  type Envelope,
  type SceneId,
} from '../shared/protocol.js';
import { applyEvent, createRoomState, type RoomState } from '../shared/state.js';
import { PRESENT_IDS } from '../shared/world.js';

const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const SCENES: SceneId[] = ['town', 'cave'];
const MOVE_PUBLISH_MS = 500;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Returns a clean payload or null when the command is malformed. */
export function sanitizeCommand(type: CommandType, raw: any): Record<string, unknown> | null {
  const p = raw && typeof raw === 'object' ? raw : {};
  switch (type) {
    case 'join_room':
      return { name: String(p.name ?? '').slice(0, 40) };
    case 'leave_room':
    case 'start_game':
      return {};
    case 'select_class':
      return CLASS_IDS.includes(p.classId) ? { classId: p.classId } : null;
    case 'move_player':
      return num(p.x) && num(p.y) && DIRS.includes(p.dir) && SCENES.includes(p.scene)
        ? { x: p.x, y: p.y, dir: p.dir, scene: p.scene }
        : null;
    case 'enter_scene':
      return SCENES.includes(p.sceneId) ? { sceneId: p.sceneId } : null;
    case 'talk_to_npc':
      return NPC_IDS.includes(p.npcId) ? { npcId: p.npcId } : null;
    case 'collect_present':
      return PRESENT_IDS.includes(p.presentId) ? { presentId: p.presentId } : null;
    case 'return_present':
      return PRESENT_IDS.includes(p.presentId) && NPC_IDS.includes(p.npcId)
        ? { presentId: p.presentId, npcId: p.npcId }
        : null;
    case 'use_attack':
      return num(p.x) && num(p.y) && DIRS.includes(p.dir) ? { x: p.x, y: p.y, dir: p.dir } : null;
    case 'heal_player':
      return num(p.x) && num(p.y)
        ? { x: p.x, y: p.y, targetId: typeof p.targetId === 'string' ? p.targetId.slice(0, 64) : undefined }
        : null;
    case 'send_chat_message':
      return typeof p.text === 'string' ? { text: p.text.slice(0, 200) } : null;
  }
}

export function cleanRoomId(raw: unknown): string {
  const s = String(raw ?? '').trim();
  return /^[A-Za-z0-9_-]{1,24}$/.test(s) ? s : 'main';
}

export interface Gateway {
  server: Server;
  io: IoServer;
  rooms: Map<string, RoomState>;
  listen(port: number): Promise<number>;
  close(): Promise<void>;
}

export async function createGateway(broker: Broker, ns: string, staticDir?: string): Promise<Gateway> {
  const app = express();
  const server = createServer(app);
  const io = new IoServer(server, { cors: { origin: true }, maxHttpBufferSize: 20_000 });
  const rooms = new Map<string, RoomState>();
  const commandsTopic = topicName('commands', ns);

  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
  app.get('/api/replay/:roomId', async (req, res) => res.json(await readReplay(req.params.roomId)));
  const dist = staticDir ?? join(process.cwd(), 'client', 'dist');
  if (existsSync(dist)) app.use(express.static(dist, { dotfiles: 'allow' }));

  const stopSub = await broker.subscribe(
    'team2.' + (ns ? ns + '-' : '') + 'gateway',
    TOPIC_KEYS.filter((k) => k !== 'commands').map((k) => topicName(k, ns)),
    (_topic, env: Envelope) => {
      let room = rooms.get(env.roomId);
      if (!room) {
        if (env.type === 'room_left') return;
        room = createRoomState(env.roomId);
        rooms.set(env.roomId, room);
      }
      applyEvent(room, env);
      if (env.type === 'command_rejected') {
        if (process.env.DEBUG_EVENTS) console.log('[rejected]', JSON.stringify(env));
        if (env.playerId) io.to(env.playerId).emit('event', env);
      } else {
        io.to(env.roomId).emit('event', env);
      }
      if (!Object.keys(room.players).length && env.type === 'room_left') rooms.delete(env.roomId);
    },
  );

  const publishCommand = (type: string, roomId: string, payload: unknown, playerId: string) =>
    broker.publish(commandsTopic, [envelope(type, roomId, payload, playerId)]);

  io.on('connection', (socket: Socket) => {
    const playerId = socket.id;
    let roomId: string | undefined;
    let joined = false;
    let spectator = false;
    let lastMovePublish = 0;
    let lastScene: SceneId | undefined;
    let tokens = 80;
    const refill = setInterval(() => (tokens = Math.min(80, tokens + 40)), 1000);

    socket.emit('welcome', { playerId });

    socket.on('spectate', (raw: unknown) => {
      if (joined || spectator) return;
      const id = cleanRoomId(typeof raw === 'string' ? raw : (raw as any)?.roomId);
      spectator = true;
      roomId = id;
      socket.join(id);
      socket.emit('snapshot', rooms.get(id) ?? createRoomState(id));
    });

    socket.on('command', (type: unknown, rawPayload: unknown) => {
      if (tokens <= 0) return;
      tokens--;
      if (typeof type !== 'string' || !isCommandType(type) || spectator) return;
      const payload = sanitizeCommand(type, rawPayload);
      if (!payload) return;

      if (type === 'join_room') {
        if (joined) return;
        roomId = cleanRoomId((rawPayload as any)?.roomId);
        joined = true;
        socket.join(roomId);
        socket.emit('snapshot', rooms.get(roomId) ?? createRoomState(roomId));
        void publishCommand(type, roomId, payload, playerId);
        return;
      }
      if (!joined || !roomId) return;

      if (type === 'move_player') {
        const p = payload as { x: number; y: number; dir: Dir; scene: SceneId };
        socket.to(roomId).volatile.emit('live', { playerId, ...p });
        const now = Date.now();
        if (now - lastMovePublish < MOVE_PUBLISH_MS && lastScene === p.scene) return;
        lastMovePublish = now;
        lastScene = p.scene;
      }
      void publishCommand(type, roomId, payload, playerId);
    });

    socket.on('disconnect', () => {
      clearInterval(refill);
      if (joined && roomId) void publishCommand('leave_room', roomId, {}, playerId);
    });
  });

  return {
    server,
    io,
    rooms,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : port);
        });
      }),
    async close() {
      await stopSub();
      io.close();
      await new Promise((r) => server.close(() => r(null)));
    },
  };
}
