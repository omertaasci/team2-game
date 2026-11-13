import type { CommandPayloads, NpcId, PlayerSummary } from '../shared/protocol.js';
import { DIALOGUE, NPC_BY_ID, PRESENT_IDS, PRESENT_OWNER } from '../shared/world.js';
import type { PresentStatus, QuestStatus } from '../shared/state.js';
import type { Service } from './runtime.js';

interface Room {
  started: boolean;
  startedAt: number;
  finished: boolean;
  names: Map<string, { name: string; classId: PlayerSummary['classId'] }>;
  quests: Record<string, QuestStatus>;
  presents: Record<string, PresentStatus>;
}

function freshRoom(): Room {
  return {
    started: false,
    startedAt: 0,
    finished: false,
    names: new Map(),
    quests: Object.fromEntries(Object.keys(NPC_BY_ID).map((n) => [n, 'idle'])),
    presents: Object.fromEntries(PRESENT_IDS.map((p) => [p, 'hidden'])),
  };
}

export function createQuest(): Service {
  const rooms = new Map<string, Room>();
  const roomOf = (id: string) => {
    let r = rooms.get(id);
    if (!r) rooms.set(id, (r = freshRoom()));
    return r;
  };

  return {
    name: 'quest',
    topics: ['commands', 'lobby', 'combat'],
    handle(topic, env, ctx) {
      const roomId = env.roomId;

      if (topic === 'lobby') {
        const r = roomOf(roomId);
        if (env.type === 'room_joined')
          r.names.set(env.payload.playerId, { name: env.payload.name, classId: env.payload.classId });
        else if (env.type === 'class_selected') {
          const m = r.names.get(env.payload.playerId);
          if (m) m.classId = env.payload.classId;
        } else if (env.type === 'room_left') {
          r.names.delete(env.payload.playerId);
          if (!r.names.size) rooms.delete(roomId);
        } else if (env.type === 'game_started') {
          Object.assign(r, { ...freshRoom(), names: r.names, started: true, startedAt: Date.now() });
        }
        return;
      }

      if (topic === 'combat') {
        const r = rooms.get(roomId);
        if (env.type === 'boss_defeated' && r?.started) {
          const unlock = PRESENT_IDS.filter((p) => r.presents[p] === 'hidden');
          if (!unlock.length) return;
          for (const p of unlock) r.presents[p] = 'available';
          ctx.emit('presents_unlocked', roomId, { presentIds: unlock });
        }
        return;
      }

      const r = rooms.get(roomId);
      const pid = env.playerId;
      if (!r || !pid || !r.names.has(pid)) return;
      if (!['talk_to_npc', 'collect_present', 'return_present'].includes(env.type)) return;
      if (!r.started) return ctx.reject(env, 'quests', 'game_not_started');

      if (env.type === 'talk_to_npc') {
        const { npcId } = env.payload as CommandPayloads['talk_to_npc'];
        const npc = NPC_BY_ID[npcId as NpcId];
        if (!npc) return ctx.reject(env, 'quests', 'unknown_npc');
        const status = r.quests[npc.id];
        const lines = DIALOGUE[npc.id];
        const chosen =
          status === 'completed'
            ? lines.completed
            : status === 'idle'
              ? lines.idle
              : r.presents[npc.presentId] === 'carried'
                ? lines.ready
                : lines.active;
        ctx.emit('npc_talked_to', roomId, { playerId: pid, npcId: npc.id, lines: chosen }, { playerId: pid });
        if (status === 'idle') {
          r.quests[npc.id] = 'active';
          ctx.emit(
            'quest_started',
            roomId,
            { questId: npc.id, npcId: npc.id, title: npc.questTitle, description: npc.questDescription },
            { playerId: pid },
          );
        }
      } else if (env.type === 'collect_present') {
        const { presentId } = env.payload as CommandPayloads['collect_present'];
        if (r.presents[presentId] !== 'available') return; // someone else was faster
        r.presents[presentId] = 'carried';
        const total = Object.values(r.presents).filter((s) => s === 'carried' || s === 'returned').length;
        ctx.emit('present_collected', roomId, { presentId, collectedBy: pid, total }, { playerId: pid });
      } else if (env.type === 'return_present') {
        const { presentId, npcId } = env.payload as CommandPayloads['return_present'];
        if (r.presents[presentId] !== 'carried') return ctx.reject(env, 'presents', 'present_not_carried');
        if (PRESENT_OWNER[presentId] !== npcId) return ctx.reject(env, 'presents', 'wrong_npc');
        if (r.quests[npcId] !== 'active') return ctx.reject(env, 'presents', 'talk_to_npc_first');
        r.presents[presentId] = 'returned';
        r.quests[npcId] = 'completed';
        ctx.emit('present_returned', roomId, { presentId, npcId, returnedBy: pid }, { playerId: pid });
        ctx.emit('quest_completed', roomId, { questId: npcId, npcId, completedBy: [pid] }, { playerId: pid });
        const returned = Object.values(r.presents).filter((s) => s === 'returned').length;
        ctx.emit('quest_progressed', roomId, { questId: 'santa', progress: returned, goal: PRESENT_IDS.length });
        if (returned === PRESENT_IDS.length && !r.finished) {
          r.finished = true;
          ctx.emit('all_presents_returned', roomId, { completedAt: new Date().toISOString() });
          ctx.emit('christmas_saved', roomId, {
            players: [...r.names].map(([id, m]) => ({ id, name: m.name, classId: m.classId })),
            durationMs: Date.now() - r.startedAt,
          });
        }
      }
    },
  };
}
