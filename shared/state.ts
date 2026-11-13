import type { ClassId, Dir, Envelope, NpcId, SceneId } from './protocol.js';
import { CLASSES, NPCS, PRESENT_IDS, SCENES } from './world.js';

export type QuestStatus = 'idle' | 'active' | 'completed';
export type PresentStatus = 'hidden' | 'available' | 'carried' | 'returned';

export interface PlayerState {
  id: string;
  name: string;
  classId: ClassId;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  dir: Dir;
  scene: SceneId;
  downed: boolean;
}

export interface RoomState {
  roomId: string;
  phase: 'lobby' | 'playing' | 'finished';
  hostId?: string;
  players: Record<string, PlayerState>;
  quests: Record<NpcId, QuestStatus>;
  presents: Record<string, PresentStatus>;
  boss: { hp: number; maxHp: number; phase: number; alive: boolean };
  scores: Record<string, number>;
  achievements: Record<string, string[]>;
  chat: { playerId: string; name: string; text: string }[];
  durationMs?: number;
}

export function createRoomState(roomId: string): RoomState {
  return {
    roomId,
    phase: 'lobby',
    players: {},
    quests: Object.fromEntries(NPCS.map((n) => [n.id, 'idle'])) as Record<NpcId, QuestStatus>,
    presents: Object.fromEntries(PRESENT_IDS.map((p) => [p, 'hidden'])) as Record<string, PresentStatus>,
    boss: { hp: 1, maxHp: 1, phase: 1, alive: true },
    scores: {},
    achievements: {},
    chat: [],
  };
}

export function applyEvent(state: RoomState, ev: Envelope): void {
  const p = ev.payload ?? {};
  switch (ev.type) {
    case 'room_joined': {
      const cls = CLASSES[p.classId as ClassId] ?? CLASSES.warrior;
      const spawn = SCENES.town.spawn;
      state.players[p.playerId] = {
        id: p.playerId,
        name: p.name,
        classId: p.classId,
        hp: cls.hp,
        maxHp: cls.hp,
        x: spawn.x,
        y: spawn.y,
        dir: 'down',
        scene: 'town',
        downed: false,
      };
      if (p.isHost) state.hostId = p.playerId;
      break;
    }
    case 'room_left':
      delete state.players[p.playerId];
      if (p.newHostId) state.hostId = p.newHostId;
      break;
    case 'class_selected': {
      const pl = state.players[p.playerId];
      if (pl) {
        pl.classId = p.classId;
        pl.maxHp = p.maxHp;
        pl.hp = p.maxHp;
      }
      break;
    }
    case 'game_started': {
      state.phase = 'playing';
      state.boss = { hp: p.bossMaxHp, maxHp: p.bossMaxHp, phase: 1, alive: true };
      for (const pl of Object.values(state.players)) {
        pl.hp = pl.maxHp;
        pl.downed = false;
        pl.scene = 'town';
        pl.x = SCENES.town.spawn.x;
        pl.y = SCENES.town.spawn.y;
      }
      break;
    }
    case 'player_moved': {
      const pl = state.players[p.playerId];
      if (pl) {
        pl.x = p.x;
        pl.y = p.y;
        pl.dir = p.dir;
        pl.scene = p.scene;
      }
      break;
    }
    case 'scene_entered': {
      const pl = state.players[p.playerId];
      if (pl) {
        pl.scene = p.sceneId;
        pl.x = p.x;
        pl.y = p.y;
      }
      break;
    }
    case 'quest_started':
      state.quests[p.questId as NpcId] = 'active';
      break;
    case 'quest_completed':
      state.quests[p.questId as NpcId] = 'completed';
      break;
    case 'presents_unlocked':
      for (const id of p.presentIds) state.presents[id] = 'available';
      break;
    case 'present_collected':
      state.presents[p.presentId] = 'carried';
      break;
    case 'present_returned':
      state.presents[p.presentId] = 'returned';
      break;
    case 'boss_damaged':
      state.boss.hp = p.hp;
      state.boss.maxHp = p.maxHp;
      break;
    case 'boss_phase_changed':
      state.boss.phase = p.phase;
      break;
    case 'boss_defeated':
      state.boss.alive = false;
      state.boss.hp = 0;
      break;
    case 'player_damaged':
    case 'player_healed': {
      const pl = state.players[p.playerId];
      if (pl) pl.hp = p.hp;
      break;
    }
    case 'player_downed': {
      const pl = state.players[p.playerId];
      if (pl) {
        pl.downed = true;
        pl.hp = 0;
      }
      break;
    }
    case 'player_revived': {
      const pl = state.players[p.playerId];
      if (pl) {
        pl.downed = false;
        pl.hp = p.hp;
      }
      break;
    }
    case 'party_wiped':
      state.boss = { hp: p.bossMaxHp, maxHp: p.bossMaxHp, phase: 1, alive: true };
      break;
    case 'chat_message_sent':
      state.chat.push({ playerId: p.playerId, name: p.name, text: p.text });
      if (state.chat.length > 50) state.chat.shift();
      break;
    case 'leaderboard_updated':
      state.scores = Object.fromEntries(p.entries.map((e: { playerId: string; score: number }) => [e.playerId, e.score]));
      break;
    case 'achievement_unlocked':
      (state.achievements[p.playerId] ??= []).includes(p.achievementId) ||
        state.achievements[p.playerId].push(p.achievementId);
      break;
    case 'christmas_saved':
      state.phase = 'finished';
      state.durationMs = p.durationMs;
      break;
  }
}
