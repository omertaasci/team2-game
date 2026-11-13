/**
 * Live smoke test against the shared Redpanda broker.
 *   $env:BROKER_PASSWORD="..."; npm run smoke:http
 * Uses a random TOPIC_NS so it never touches other people's topics.
 */
import 'dotenv/config';
import { io as connect } from 'socket.io-client';
import { createBroker, loadConfig } from '../broker/index.js';
import { createGateway } from '../gateway/index.js';
import { startServices } from '../services/index.js';

const cfg = { ...loadConfig(), kind: 'http' as const, ns: 'smoke' };
if (!cfg.password) {
  console.error('Set BROKER_PASSWORD first.');
  process.exit(1);
}

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

log(`namespace ${cfg.ns}: warming up topics...`);
const broker = await createBroker(cfg);
const stopServices = await startServices(broker, cfg.ns);
const gw = await createGateway(broker, cfg.ns);
const port = await gw.listen(0);
log('server up');

const s = connect(`http://localhost:${port}`, { transports: ['websocket'] });
const seen: string[] = [];
s.on('event', (e) => {
  seen.push(e.type);
  log(`event ${e.type}`);
});
await new Promise((r) => s.once('welcome', r));

const wait = (type: string, ms = 30000) =>
  new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (seen.includes(type)) (clearInterval(iv), resolve());
      else if (Date.now() - start > ms) (clearInterval(iv), reject(new Error('timeout waiting for ' + type)));
    }, 50);
  });

let ok = false;
try {
  s.emit('command', 'join_room', { name: 'Smoke', roomId: 'smoke' });
  const a = Date.now();
  await wait('room_joined');
  log(`join round trip through broker: ${Date.now() - a} ms`);
  s.emit('command', 'start_game', {});
  await wait('game_started');
  s.emit('command', 'enter_scene', { sceneId: 'cave' });
  await wait('scene_entered');
  ok = true;
} catch (e) {
  console.error(e);
} finally {
  s.close();
  await gw.close();
  await stopServices();
  await broker.close();
}
log(ok ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
