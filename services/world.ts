import type { CommandPayloads, Dir, SceneId } from '../shared/protocol.js';
import { MOVE_BOUNDS, SCENES, TOWN_RETURN_SPAWN } from '../shared/world.js';
import type { Service } from './runtime.js';

interface WPlayer {
  scene: SceneId;
}
interface Room {
  started: boolean;
  players: Map<string, WPlayer>;
}

const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function createWorld(): Service {
  const rooms = new Map<string, Room>();
  const roomOf = (id: string) => {
    let r = rooms.get(id);
    if (!r) rooms.set(id, (r = { started: false, players: new Map() }));
    return r;
  };

  return {
    name: 'world',
    topics: ['commands', 'lobby'],
    handle(topic, env, ctx) {
      const pid = env.playerId;
      if (topic === 'lobby') {
        const r = roomOf(env.roomId);
        if (env.type === 'room_joined') r.players.set(env.payload.playerId, { scene: 'town' });
        else if (env.type === 'room_left') {
          r.players.delete(env.payload.playerId);
          if (!r.players.size) rooms.delete(env.roomId);
        } else if (env.type === 'game_started') {
          r.started = true;
          for (const p of r.players.values()) p.scene = 'town';
        }
        return;
      }

      const room = rooms.get(env.roomId);
      const me = pid ? room?.players.get(pid) : undefined;
      if (!room || !pid || !me) return;

      if (env.type === 'move_player') {
        const p = env.payload as CommandPayloads['move_player'];
        if (!room.started || p?.scene !== me.scene) return;
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        const b = MOVE_BOUNDS[me.scene];
        const dir = DIRS.includes(p.dir) ? p.dir : 'down';
        ctx.emit(
          'player_moved',
          env.roomId,
          { playerId: pid, x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY), dir, scene: me.scene },
          { playerId: pid },
        );
      } else if (env.type === 'enter_scene') {
        const p = env.payload as CommandPayloads['enter_scene'];
        if (!room.started) return ctx.reject(env, 'world', 'game_not_started');
        if (p?.sceneId !== 'town' && p?.sceneId !== 'cave') return;
        if (p.sceneId === me.scene) return;
        me.scene = p.sceneId;
        const spawn = p.sceneId === 'cave' ? SCENES.cave.spawn : TOWN_RETURN_SPAWN;
        ctx.emit('scene_entered', env.roomId, { playerId: pid, sceneId: p.sceneId, ...spawn }, { playerId: pid });
      }
    },
  };
}
