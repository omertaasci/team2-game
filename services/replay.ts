import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Service } from './runtime.js';

export function replayDir(): string {
  return process.env.REPLAY_DIR ?? join(process.cwd(), 'data', 'replays');
}

const safe = (roomId: string) => roomId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

export function createReplay(): Service {
  let ready: Promise<unknown> | undefined;

  return {
    name: 'replay',
    topics: ['lobby', 'world', 'quests', 'presents', 'combat', 'chat', 'progress'],
    async handle(_topic, env) {
      if (env.type === 'player_moved') return; // checkpoints are too noisy for replays
      ready ??= mkdir(replayDir(), { recursive: true });
      await ready;
      await appendFile(join(replayDir(), `${safe(env.roomId)}.jsonl`), JSON.stringify(env) + '\n');
    },
  };
}

export async function readReplay(roomId: string): Promise<unknown[]> {
  try {
    const text = await readFile(join(replayDir(), `${safe(roomId)}.jsonl`), 'utf8');
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
