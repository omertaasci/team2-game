import { envelope, type Envelope } from '../shared/protocol.js';

export type Handler = (topic: string, env: Envelope) => void | Promise<void>;

export interface Broker {
  publish(topic: string, messages: Envelope[]): Promise<void>;
  /** Every group receives every message of the topics it subscribes to. */
  subscribe(group: string, topics: string[], handler: Handler): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export interface BrokerConfig {
  kind: 'memory' | 'http';
  url: string;
  user: string;
  password: string;
  ns: string;
  port: number;
  /** When set, all logical topics share this one physical topic (workaround for broken topic auto-creation). */
  singleTopic: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  return {
    kind: env.BROKER === 'http' ? 'http' : 'memory',
    url: (env.BROKER_URL ?? 'https://edp-broker.codewithpeter.com').replace(/\/$/, ''),
    user: env.BROKER_USER ?? 'team2',
    password: env.BROKER_PASSWORD ?? '',
    ns: env.TOPIC_NS ?? '',
    port: Number(env.PORT ?? 3000),
    singleTopic: env.BROKER_TOPICS === 'single' ? (env.BROKER_SINGLE_TOPIC ?? 'team2.events') : '',
  };
}

export function warmupEnvelope(): Envelope {
  return envelope('topic_warmup', '_system', {});
}
