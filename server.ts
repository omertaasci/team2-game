import 'dotenv/config';
import { createBroker, loadConfig } from './broker/index.js';
import { createGateway } from './gateway/index.js';
import { startServices } from './services/index.js';

/**
 * Usage:
 *   tsx server.ts                     gateway + all services in one process
 *   tsx server.ts --services=quest    only the listed services (no gateway)
 *   tsx server.ts --gateway           only the gateway
 */
const args = process.argv.slice(2);
const servicesArg = args.find((a) => a.startsWith('--services='));
const onlyGateway = args.includes('--gateway');
const only = servicesArg?.slice('--services='.length).split(',').filter(Boolean);

const cfg = loadConfig();
if (cfg.kind === 'memory' && (only || onlyGateway)) {
  console.error('Running parts separately needs BROKER=http (the in-memory broker only works in one process).');
  process.exit(1);
}

const broker = await createBroker(cfg);
const stops: (() => Promise<void>)[] = [];

if (!onlyGateway) stops.push(await startServices(broker, cfg.ns, only));
if (!only) {
  const gateway = await createGateway(broker, cfg.ns);
  const port = await gateway.listen(cfg.port);
  console.log(`[gateway] listening on http://localhost:${port}`);
  stops.push(() => gateway.close());
}

const shutdown = async () => {
  console.log('shutting down...');
  await Promise.all(stops.map((s) => s()));
  await broker.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
