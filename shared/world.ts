import type { ClassId, NpcId, SceneId } from './protocol.js';

export const MAX_PLAYERS = 6;

export interface ClassDef {
  label: string;
  hp: number;
  damage: number;
  cooldownMs: number;
  range: number;
  speed: number;
  color: number;
  blurb: string;
}

export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: { label: 'Warrior', hp: 160, damage: 18, cooldownMs: 450, range: 34, speed: 80, color: 0xff6b6b, blurb: 'Strong melee, high health' },
  mage: { label: 'Mage', hp: 100, damage: 14, cooldownMs: 800, range: 150, speed: 75, color: 0xb388ff, blurb: 'Magic bolts from range' },
  archer: { label: 'Archer', hp: 110, damage: 9, cooldownMs: 350, range: 200, speed: 90, color: 0x7bd88f, blurb: 'Fast arrows from far away' },
  healer: { label: 'Healer', hp: 110, damage: 4, cooldownMs: 600, range: 110, speed: 80, color: 0xffe066, blurb: 'Heals and revives teammates' },
};

export const HEAL = { amount: 24, cooldownMs: 2500, range: 90 };

export const SCENES: Record<SceneId, { width: number; height: number; spawn: { x: number; y: number } }> = {
  town: { width: 640, height: 448, spawn: { x: 320, y: 340 } },
  cave: { width: 480, height: 352, spawn: { x: 240, y: 300 } },
};

export const TOWN_CAVE_ENTRANCE = { x: 596, y: 190, w: 44, h: 64 };
export const CAVE_EXIT = { x: 200, y: 328, w: 80, h: 24 };
export const TOWN_RETURN_SPAWN = { x: 560, y: 222 };

export const BOSS = {
  x: 240,
  y: 110,
  hitRadius: 34,
  baseHp: 240,
  hpPerPlayer: 160,
  phase2At: 0.5,
  attackIntervalMs: [3600, 2300],
  telegraphMs: 2200,
  radius: [46, 40],
  damage: [22, 28],
  reviveAfterMs: 9000,
};

export function bossMaxHp(players: number): number {
  return BOSS.baseHp + BOSS.hpPerPlayer * Math.max(1, players);
}

export interface NpcDef {
  id: NpcId;
  name: string;
  x: number;
  y: number;
  tint: number;
  questTitle: string;
  questDescription: string;
  presentId: string;
  presentName: string;
}

export const NPCS: NpcDef[] = [
  {
    id: 'santa', name: 'Santa', x: 320, y: 140, tint: 0xff4d4d,
    questTitle: "Santa's Sack", questDescription: "Recover Santa's sack of presents from the Ice King's cave.",
    presentId: 'santa_sack', presentName: "Santa's sack",
  },
  {
    id: 'elf', name: 'Elf', x: 130, y: 190, tint: 0x66dd66,
    questTitle: "The Elf's Lost Gift", questDescription: "Find the Elf's lost gift in the Ice Cave.",
    presentId: 'elf_gift', presentName: "Elf's gift",
  },
  {
    id: 'toy_maker', name: 'Toy Maker', x: 505, y: 150, tint: 0xd2a679,
    questTitle: 'Stolen Toys', questDescription: "Bring back the Toy Maker's stolen presents.",
    presentId: 'toy_maker_toys', presentName: "Toy Maker's toys",
  },
  {
    id: 'snowman', name: 'Snowman', x: 140, y: 330, tint: 0xffffff,
    questTitle: 'The Snow Crystal', questDescription: "Recover the Snowman's magical snow crystal.",
    presentId: 'snowman_crystal', presentName: 'Snow crystal',
  },
  {
    id: 'reindeer_keeper', name: 'Reindeer Keeper', x: 500, y: 335, tint: 0xc9a46a,
    questTitle: "The Reindeer's Gift", questDescription: 'Find the special gift for the reindeer.',
    presentId: 'reindeer_gift', presentName: "Reindeer's gift",
  },
];

export const NPC_BY_ID = Object.fromEntries(NPCS.map((n) => [n.id, n])) as Record<NpcId, NpcDef>;
export const PRESENT_IDS = NPCS.map((n) => n.presentId);
export const PRESENT_OWNER = Object.fromEntries(NPCS.map((n) => [n.presentId, n.id])) as Record<string, NpcId>;
export const PRESENT_POSITIONS: Record<string, { x: number; y: number }> = {
  santa_sack: { x: 240, y: 60 },
  elf_gift: { x: 70, y: 100 },
  toy_maker_toys: { x: 410, y: 100 },
  snowman_crystal: { x: 80, y: 220 },
  reindeer_gift: { x: 400, y: 220 },
};

export const DIALOGUE: Record<NpcId, { idle: string[]; active: string[]; ready: string[]; completed: string[] }> = {
  santa: {
    idle: [
      'Ho ho... oh dear. The Ice King stole all our Christmas presents!',
      'He hid them in his cave east of the village. Please, defeat him together!',
    ],
    active: ['The cave is to the east. Be brave, and bring my sack back!'],
    ready: ['My sack! You really did it! Thank you, heroes!'],
    completed: ['Merry Christmas! Your bravery saved the day!'],
  },
  elf: {
    idle: ['Oh no, my gift is gone! The Ice King took it.', 'Please find it, it is in his cave!'],
    active: ["Have you found my gift yet? It is wrapped in green paper."],
    ready: ['My gift! Thank you so much!'],
    completed: ['I will never lose a gift again. Promise!'],
  },
  toy_maker: {
    idle: ["All my toys were stolen!", 'They must be inside the Ice Cave. Can you get them back?'],
    active: ['I cannot make a single toy without them...'],
    ready: ['My toys! Now the workshop can open again!'],
    completed: ['The workshop is busy again, thanks to you.'],
  },
  snowman: {
    idle: ['Brrr... my magical snow crystal is gone!', 'Without it I cannot keep the snow falling.'],
    active: ['I feel a bit... melty. Please hurry!'],
    ready: ['My crystal! Let it snow, let it snow!'],
    completed: ['The snow is perfect again. Thank you!'],
  },
  reindeer_keeper: {
    idle: ['The reindeer need their special gift before the big flight.', 'The Ice King locked it in his cave.'],
    active: ['The reindeer are restless. Please find their gift!'],
    ready: ['The reindeer will be so happy!'],
    completed: ['The reindeer are ready to fly. Merry Christmas!'],
  },
};

export const ACHIEVEMENTS: Record<string, { title: string; description: string }> = {
  first_blow: { title: 'First Blow', description: 'Hit the Ice King for the first time.' },
  helping_hand: { title: 'Helping Hand', description: 'Heal your team for 100 HP in total.' },
  village_friend: { title: 'Village Friend', description: 'Talk to all five villagers.' },
  present_hunter: { title: 'Present Hunter', description: 'Collect 3 presents.' },
  never_give_up: { title: 'Never Give Up', description: 'Get back up after being downed.' },
  boss_slayer: { title: 'Ice Breaker', description: 'Help defeat the Ice King.' },
  christmas_hero: { title: 'Christmas Hero', description: 'Save Christmas!' },
};

export const MOVE_BOUNDS: Record<SceneId, { minX: number; maxX: number; minY: number; maxY: number }> = {
  town: { minX: 8, maxX: 632, minY: 8, maxY: 440 },
  cave: { minX: 24, maxX: 456, minY: 40, maxY: 344 },
};
