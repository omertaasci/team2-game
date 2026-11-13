import type { Broker } from '../broker/index.js';
import {
  EVENT_TOPIC,
  TOPIC_KEYS,
  envelope,
  groupName,
  topicName,
  type Envelope,
  type EventPayloads,
  type EventType,
  type TopicKey,
} from '../shared/protocol.js';

export interface EmitOptions {
  playerId?: string;
  topic?: TopicKey;
}

export interface ServiceContext {
  emit<K extends EventType>(type: K, roomId: string, payload: EventPayloads[K], opts?: EmitOptions): void;
  reject(cmd: Envelope, topic: TopicKey, reason: string): void;
}

export interface Service {
  name: string;
  topics: TopicKey[];
  handle(topic: TopicKey, env: Envelope, ctx: ServiceContext): void | Promise<void>;
  tick?(ctx: ServiceContext, now: number): void;
  tickMs?: number;
}

export function makeContext(broker: Broker, ns: string): ServiceContext {
  const emit: ServiceContext['emit'] = (type, roomId, payload, opts = {}) => {
    const topic = topicName(opts.topic ?? EVENT_TOPIC[type], ns);
    void broker.publish(topic, [envelope(type, roomId, payload, opts.playerId)]);
  };
  return {
    emit,
    reject(cmd, topic, reason) {
      emit('command_rejected', cmd.roomId, { command: cmd.type, reason }, { playerId: cmd.playerId, topic });
    },
  };
}

export async function runService(broker: Broker, ns: string, service: Service): Promise<() => Promise<void>> {
  const ctx = makeContext(broker, ns);
  const byName = new Map(TOPIC_KEYS.map((k) => [topicName(k, ns), k] as const));
  const seen = new Set<string>();

  const stopSub = await broker.subscribe(
    groupName(service.name, ns),
    service.topics.map((k) => topicName(k, ns)),
    async (topic, env) => {
      if (seen.has(env.id)) return;
      seen.add(env.id);
      if (seen.size > 20000) seen.delete(seen.values().next().value as string);
      const key = byName.get(topic);
      if (!key) return;
      try {
        await service.handle(key, env, ctx);
      } catch (e) {
        console.error(`[${service.name}] failed to handle ${env.type}`, e);
      }
    },
  );

  let timer: NodeJS.Timeout | undefined;
  if (service.tick) {
    timer = setInterval(() => {
      try {
        service.tick!(ctx, Date.now());
      } catch (e) {
        console.error(`[${service.name}] tick failed`, e);
      }
    }, service.tickMs ?? 250);
  }

  return async () => {
    if (timer) clearInterval(timer);
    await stopSub();
  };
}
