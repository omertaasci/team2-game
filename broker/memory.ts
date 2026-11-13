import type { Envelope } from '../shared/protocol.js';
import type { Broker, Handler } from './broker.js';

interface Sub {
  group: string;
  topics: Set<string>;
  handler: Handler;
}

/** In-process broker with the same semantics as the real one: every group sees every message. */
export class MemoryBroker implements Broker {
  private subs = new Set<Sub>();
  private closed = false;

  async publish(topic: string, messages: Envelope[]): Promise<void> {
    for (const msg of messages) {
      for (const sub of this.subs) {
        if (!sub.topics.has(topic)) continue;
        setImmediate(() => {
          if (this.closed || !this.subs.has(sub)) return;
          Promise.resolve(sub.handler(topic, structuredClone(msg))).catch((e) =>
            console.error(`[memory-broker] handler ${sub.group} failed`, e),
          );
        });
      }
    }
  }

  async subscribe(group: string, topics: string[], handler: Handler) {
    const sub: Sub = { group, topics: new Set(topics), handler };
    this.subs.add(sub);
    return async () => {
      this.subs.delete(sub);
    };
  }

  async close() {
    this.closed = true;
    this.subs.clear();
  }
}
