export const CLASS_IDS = ['warrior', 'mage', 'archer', 'healer'] as const;
export type ClassId = (typeof CLASS_IDS)[number];
export type SceneId = 'town' | 'cave';
export type Dir = 'down' | 'up' | 'left' | 'right';

export const NPC_IDS = ['santa', 'elf', 'toy_maker', 'snowman', 'reindeer_keeper'] as const;
export type NpcId = (typeof NPC_IDS)[number];

export const TOPIC_KEYS = [
  'commands',
  'lobby',
  'world',
  'quests',
  'presents',
  'combat',
  'chat',
  'progress',
] as const;
export type TopicKey = (typeof TOPIC_KEYS)[number];

export function topicName(key: TopicKey, ns = ''): string {
  return `team2.${ns ? ns + '.' : ''}${key}`;
}

export function groupName(service: string, ns = ''): string {
  return `team2.${ns ? ns + '-' : ''}${service}`;
}

export interface Envelope<P = any> {
  id: string;
  type: string;
  roomId: string;
  playerId?: string;
  timestamp: string;
  payload: P;
  /** Last position the gateway saw for the player; movement itself never goes through the broker. */
  pos?: { x: number; y: number; scene: SceneId };
}

export const COMMAND_TYPES = [
  'join_room',
  'leave_room',
  'select_class',
  'start_game',
  'move_player',
  'enter_scene',
  'talk_to_npc',
  'collect_present',
  'return_present',
  'use_attack',
  'heal_player',
  'send_chat_message',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export interface CommandPayloads {
  join_room: { name: string };
  leave_room: Record<string, never>;
  select_class: { classId: ClassId };
  start_game: Record<string, never>;
  move_player: { x: number; y: number; dir: Dir; scene: SceneId };
  enter_scene: { sceneId: SceneId };
  talk_to_npc: { npcId: NpcId };
  collect_present: { presentId: string };
  return_present: { presentId: string; npcId: NpcId };
  use_attack: { x: number; y: number; dir: Dir };
  heal_player: { targetId?: string; x: number; y: number };
  send_chat_message: { text: string };
}

export const EVENT_TOPIC = {
  room_joined: 'lobby',
  room_left: 'lobby',
  class_selected: 'lobby',
  game_started: 'lobby',
  command_rejected: 'lobby',
  scene_entered: 'world',
  npc_talked_to: 'quests',
  quest_started: 'quests',
  quest_progressed: 'quests',
  quest_completed: 'quests',
  presents_unlocked: 'presents',
  present_collected: 'presents',
  present_returned: 'presents',
  all_presents_returned: 'presents',
  attack_used: 'combat',
  projectile_spawned: 'combat',
  boss_damaged: 'combat',
  boss_attacked: 'combat',
  boss_phase_changed: 'combat',
  boss_defeated: 'combat',
  player_damaged: 'combat',
  player_healed: 'combat',
  player_downed: 'combat',
  player_revived: 'combat',
  party_wiped: 'combat',
  chat_message_sent: 'chat',
  christmas_saved: 'progress',
  achievement_unlocked: 'progress',
  leaderboard_updated: 'progress',
} as const satisfies Record<string, TopicKey>;
export type EventType = keyof typeof EVENT_TOPIC;

export interface PlayerSummary {
  id: string;
  name: string;
  classId: ClassId;
}

export interface EventPayloads {
  room_joined: { playerId: string; name: string; classId: ClassId; isHost: boolean; started: boolean };
  room_left: { playerId: string; newHostId?: string };
  class_selected: { playerId: string; classId: ClassId; maxHp: number };
  game_started: { players: PlayerSummary[]; bossMaxHp: number };
  command_rejected: { command: string; reason: string };
  scene_entered: { playerId: string; sceneId: SceneId; x: number; y: number };
  npc_talked_to: { playerId: string; npcId: NpcId; lines: string[] };
  quest_started: { questId: NpcId; npcId: NpcId; title: string; description: string };
  quest_progressed: { questId: NpcId; progress: number; goal: number };
  quest_completed: { questId: NpcId; npcId: NpcId; completedBy: string[] };
  presents_unlocked: { presentIds: string[] };
  present_collected: { presentId: string; collectedBy: string; total: number };
  present_returned: { presentId: string; npcId: NpcId; returnedBy: string };
  all_presents_returned: { completedAt: string };
  attack_used: { playerId: string; classId: ClassId; x: number; y: number; dir: Dir };
  projectile_spawned: {
    projectileId: string;
    ownerId: string;
    type: 'bolt' | 'arrow';
    x: number;
    y: number;
    toX: number;
    toY: number;
  };
  boss_damaged: { attackerId: string; damage: number; hp: number; maxHp: number };
  boss_attacked: { attackId: string; x: number; y: number; radius: number; delayMs: number };
  boss_phase_changed: { phase: number };
  boss_defeated: { contributors: string[] };
  player_damaged: { playerId: string; damage: number; hp: number; sourceId: string };
  player_healed: { playerId: string; healerId: string; amount: number; hp: number };
  player_downed: { playerId: string };
  player_revived: { playerId: string; hp: number };
  party_wiped: { bossMaxHp: number };
  chat_message_sent: { playerId: string; name: string; text: string };
  christmas_saved: { players: PlayerSummary[]; durationMs: number };
  achievement_unlocked: { playerId: string; achievementId: string };
  leaderboard_updated: { entries: { playerId: string; name: string; score: number }[] };
}

export type GameEvent<K extends EventType = EventType> = Envelope<EventPayloads[K]> & { type: K };

export function isEventType(t: string): t is EventType {
  return t in EVENT_TOPIC;
}
export function isCommandType(t: string): t is CommandType {
  return (COMMAND_TYPES as readonly string[]).includes(t);
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e9;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${counter.toString(36)}`;
}

export function envelope<P>(type: string, roomId: string, payload: P, playerId?: string): Envelope<P> {
  return { id: newId(), type, roomId, playerId, timestamp: new Date().toISOString(), payload };
}
