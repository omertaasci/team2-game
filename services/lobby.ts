import { CLASS_IDS, type ClassId, type CommandPayloads } from '../shared/protocol.js';
import { CLASSES, MAX_PLAYERS, bossMaxHp } from '../shared/world.js';
import type { Service } from './runtime.js';

interface Room {
  players: Map<string, { name: string; classId: ClassId }>;
  hostId?: string;
  started: boolean;
}

export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16);
  return s || 'Player';
}

export function createLobby(): Service {
  const rooms = new Map<string, Room>();

  return {
    name: 'lobby',
    topics: ['commands'],
    handle(_topic, env, ctx) {
      const pid = env.playerId;
      if (!pid) return;
      const roomId = env.roomId;
      const room = rooms.get(roomId);

      switch (env.type) {
        case 'join_room': {
          const p = env.payload as CommandPayloads['join_room'];
          const r = room ?? ({ players: new Map(), started: false } as Room);
          if (r.players.has(pid)) return;
          if (r.players.size >= MAX_PLAYERS) return ctx.reject(env, 'lobby', 'room_full');
          rooms.set(roomId, r);
          const isHost = r.players.size === 0;
          if (isHost) r.hostId = pid;
          const name = cleanName(p?.name);
          r.players.set(pid, { name, classId: 'warrior' });
          ctx.emit(
            'room_joined',
            roomId,
            { playerId: pid, name, classId: 'warrior', isHost, started: r.started },
            { playerId: pid },
          );
          break;
        }
        case 'leave_room': {
          if (!room?.players.has(pid)) return;
          room.players.delete(pid);
          let newHostId: string | undefined;
          if (room.hostId === pid) {
            room.hostId = room.players.keys().next().value;
            newHostId = room.hostId;
          }
          if (room.players.size === 0) rooms.delete(roomId);
          ctx.emit('room_left', roomId, { playerId: pid, newHostId }, { playerId: pid });
          break;
        }
        case 'select_class': {
          const p = env.payload as CommandPayloads['select_class'];
          const member = room?.players.get(pid);
          if (!room || !member) return;
          if (!CLASS_IDS.includes(p?.classId)) return ctx.reject(env, 'lobby', 'invalid_class');
          if (room.started) return ctx.reject(env, 'lobby', 'game_already_started');
          member.classId = p.classId;
          ctx.emit(
            'class_selected',
            roomId,
            { playerId: pid, classId: p.classId, maxHp: CLASSES[p.classId].hp },
            { playerId: pid },
          );
          break;
        }
        case 'start_game': {
          if (!room?.players.has(pid) || room.started) return;
          if (room.hostId !== pid) return ctx.reject(env, 'lobby', 'only_host_can_start');
          room.started = true;
          const players = [...room.players].map(([id, m]) => ({ id, name: m.name, classId: m.classId }));
          ctx.emit('game_started', roomId, { players, bossMaxHp: bossMaxHp(players.length) }, { playerId: pid });
          break;
        }
      }
    },
  };
}
