import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryBroker } from '../broker/memory.js';
import { createGateway, type Gateway } from '../gateway/index.js';
import { startServices } from '../services/index.js';

let gw: Gateway;
let stop: () => Promise<void>;
let port: number;

interface Client {
  s: Socket;
  events: any[];
  id: string;
  cmd(type: string, payload?: unknown): void;
  waitFor(type: string, pred?: (e: any) => boolean): Promise<any>;
}

function client(): Promise<Client> {
  return new Promise((resolve) => {
    const s = connect(`http://localhost:${port}`, { transports: ['websocket'] });
    const events: any[] = [];
    const c: Client = {
      s,
      events,
      id: '',
      cmd: (type, payload = {}) => s.emit('command', type, payload),
      waitFor: (type, pred = () => true) =>
        new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout waiting for ' + type)), 4000);
          const check = () => {
            const e = events.find((x) => x.type === type && pred(x));
            if (e) {
              clearTimeout(t);
              clearInterval(iv);
              res(e);
            }
          };
          const iv = setInterval(check, 20);
          check();
        }),
    };
    s.on('event', (e) => events.push(e));
    s.on('welcome', (w) => {
      c.id = w.playerId;
      resolve(c);
    });
  });
}

beforeAll(async () => {
  const broker = new MemoryBroker();
  stop = await startServices(broker, '');
  gw = await createGateway(broker, '');
  port = await gw.listen(0);
});
afterAll(async () => {
  await gw.close();
  await stop();
});

describe('full game flow over the event broker', () => {
  it('lobby -> boss fight -> quests -> christmas saved', async () => {
    const a = await client();
    const b = await client();
    a.cmd('join_room', { name: 'Alice', roomId: 'r1' });
    await a.waitFor('room_joined');
    b.cmd('join_room', { name: 'Bob', roomId: 'r1' });
    await b.waitFor('room_joined', (e) => e.payload.playerId === b.id);

    a.cmd('select_class', { classId: 'warrior' });
    b.cmd('select_class', { classId: 'healer' });
    await b.waitFor('class_selected', (e) => e.payload.playerId === b.id);

    b.cmd('start_game');
    const rej = await b.waitFor('command_rejected');
    expect(rej.payload.reason).toBe('only_host_can_start');
    expect(b.events.filter((e) => e.type === 'command_rejected')).toHaveLength(1);
    a.cmd('start_game');
    const started = await a.waitFor('game_started');
    expect(started.payload.bossMaxHp).toBeGreaterThan(0);

    a.cmd('enter_scene', { sceneId: 'cave' });
    await a.waitFor('scene_entered');
    a.cmd('move_player', { x: 240, y: 150, dir: 'up', scene: 'cave' });
    await a.waitFor('player_moved');

    let hp = started.payload.bossMaxHp;
    let t = 0;
    while (hp > 0 && t++ < 100) {
      a.cmd('use_attack', { x: 240, y: 150, dir: 'up' });
      await new Promise((r) => setTimeout(r, 520));
      const last = [...a.events].reverse().find((e) => e.type === 'boss_damaged');
      if (last) hp = last.payload.hp;
      if (a.events.some((e) => e.type === 'boss_defeated')) break;
    }
    await a.waitFor('boss_defeated');
    await a.waitFor('presents_unlocked');
    await a.waitFor('achievement_unlocked', (e) => e.payload.achievementId === 'boss_slayer');
    await a.waitFor('leaderboard_updated');
  }, 60_000);

  it('rejects malformed commands and unknown types silently', async () => {
    const c = await client();
    c.s.emit('command', 'drop_database', {});
    c.cmd('join_room', { name: 'X', roomId: 'r2' });
    await c.waitFor('room_joined');
    c.cmd('select_class', { classId: 'hacker' });
    await new Promise((r) => setTimeout(r, 300));
    expect(c.events.some((e) => e.type === 'class_selected')).toBe(false);
  });
});
