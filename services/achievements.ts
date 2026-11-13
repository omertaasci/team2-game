import type { NpcId } from '../shared/protocol.js';
import { NPCS } from '../shared/world.js';
import type { Service } from './runtime.js';

interface Progress {
  hits: number;
  healed: number;
  talked: Set<NpcId>;
  collected: number;
  wasDowned: boolean;
  unlocked: Set<string>;
}

export function createAchievements(): Service {
  const rooms = new Map<string, Map<string, Progress>>();

  const get = (roomId: string, pid: string): Progress | undefined => rooms.get(roomId)?.get(pid);

  return {
    name: 'achievements',
    topics: ['lobby', 'quests', 'presents', 'combat', 'progress'],
    handle(_topic, env, ctx) {
      const p = env.payload;
      const unlock = (pid: string, id: string) => {
        const pr = get(env.roomId, pid);
        if (!pr || pr.unlocked.has(id)) return;
        pr.unlocked.add(id);
        ctx.emit('achievement_unlocked', env.roomId, { playerId: pid, achievementId: id }, { playerId: pid });
      };

      switch (env.type) {
        case 'room_joined': {
          if (!rooms.has(env.roomId)) rooms.set(env.roomId, new Map());
          const room = rooms.get(env.roomId)!;
          if (!room.has(p.playerId))
            room.set(p.playerId, { hits: 0, healed: 0, talked: new Set(), collected: 0, wasDowned: false, unlocked: new Set() });
          break;
        }
        case 'room_left': {
          const room = rooms.get(env.roomId);
          room?.delete(p.playerId);
          if (room && !room.size) rooms.delete(env.roomId);
          break;
        }
        case 'boss_damaged': {
          const pr = get(env.roomId, p.attackerId);
          if (!pr) break;
          pr.hits++;
          unlock(p.attackerId, 'first_blow');
          break;
        }
        case 'player_healed': {
          const pr = get(env.roomId, p.healerId);
          if (!pr) break;
          pr.healed += p.amount;
          if (pr.healed >= 100) unlock(p.healerId, 'helping_hand');
          break;
        }
        case 'npc_talked_to': {
          const pr = get(env.roomId, p.playerId);
          if (!pr) break;
          pr.talked.add(p.npcId);
          if (pr.talked.size >= NPCS.length) unlock(p.playerId, 'village_friend');
          break;
        }
        case 'present_collected': {
          const pr = get(env.roomId, p.collectedBy);
          if (!pr) break;
          pr.collected++;
          if (pr.collected >= 3) unlock(p.collectedBy, 'present_hunter');
          break;
        }
        case 'player_downed': {
          const pr = get(env.roomId, p.playerId);
          if (pr) pr.wasDowned = true;
          break;
        }
        case 'player_revived': {
          const pr = get(env.roomId, p.playerId);
          if (pr?.wasDowned) unlock(p.playerId, 'never_give_up');
          break;
        }
        case 'boss_defeated':
          for (const id of p.contributors) unlock(id, 'boss_slayer');
          break;
        case 'christmas_saved':
          for (const pl of p.players) unlock(pl.id, 'christmas_hero');
          break;
      }
    },
  };
}
