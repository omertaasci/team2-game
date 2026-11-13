import type { Broker } from '../broker/index.js';
import { createAchievements } from './achievements.js';
import { createChat } from './chat.js';
import { createCombat } from './combat.js';
import { createLeaderboard } from './leaderboard.js';
import { createLobby } from './lobby.js';
import { createQuest } from './quest.js';
import { createReplay } from './replay.js';
import { runService, type Service } from './runtime.js';
import { createWorld } from './world.js';

export const SERVICE_FACTORIES: Record<string, () => Service> = {
  lobby: createLobby,
  world: createWorld,
  quest: createQuest,
  combat: createCombat,
  chat: createChat,
  leaderboard: createLeaderboard,
  achievements: createAchievements,
  replay: createReplay,
};

export async function startServices(broker: Broker, ns: string, only?: string[]) {
  const names = only?.length ? only : Object.keys(SERVICE_FACTORIES);
  const stops: (() => Promise<void>)[] = [];
  for (const name of names) {
    const factory = SERVICE_FACTORIES[name];
    if (!factory) throw new Error(`Unknown service "${name}". Available: ${Object.keys(SERVICE_FACTORIES).join(', ')}`);
    stops.push(await runService(broker, ns, factory()));
    console.log(`[services] ${name} started`);
  }
  return async () => {
    await Promise.all(stops.map((s) => s()));
  };
}
