import { loadConfig, type Broker, type BrokerConfig } from './broker.js';
import { HttpBroker } from './http.js';
import { MemoryBroker } from './memory.js';
import { TOPIC_KEYS, topicName } from '../shared/protocol.js';

export type { Broker, BrokerConfig } from './broker.js';
export { loadConfig } from './broker.js';
export { MemoryBroker } from './memory.js';
export { HttpBroker } from './http.js';

export async function createBroker(cfg: BrokerConfig = loadConfig()): Promise<Broker> {
  if (cfg.kind === 'http') {
    if (!cfg.password) throw new Error('BROKER_PASSWORD is not set (see .env.example)');
    const broker = new HttpBroker(cfg);
    console.log(`[broker] using ${cfg.url} (namespace "${cfg.ns || '-'}"), preparing topics...`);
    await broker.prepare(TOPIC_KEYS.map((k) => topicName(k, cfg.ns)));
    console.log('[broker] topics ready');
    return broker;
  }
  console.log('[broker] using in-memory broker');
  return new MemoryBroker();
}
