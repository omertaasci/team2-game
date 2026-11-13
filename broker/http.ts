import type { Envelope } from '../shared/protocol.js';
import { warmupEnvelope, type Broker, type BrokerConfig, type Handler } from './broker.js';

const JSON_PRODUCE = 'application/vnd.kafka.json.v2+json';
const KAFKA_V2 = 'application/vnd.kafka.v2+json';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PendingBatch {
  records: { key: string; value: Envelope & { _topic?: string } }[];
  sending: boolean;
}

/** Redpanda / Kafka REST proxy client (HTTP). */
export class HttpBroker implements Broker {
  private auth: string;
  private pending = new Map<string, PendingBatch>();
  private stops = new Set<() => Promise<void>>();
  private closed = false;

  constructor(private cfg: BrokerConfig) {
    this.auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  }

  private async call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    return fetch(this.cfg.url + path, {
      ...init,
      headers: { Authorization: this.auth, ...(init.headers ?? {}) },
    });
  }

  /** New topics are created on first publish, which can take several seconds. */
  async prepare(topics: string[]): Promise<void> {
    if (this.cfg.singleTopic) return;
    await Promise.all(
      topics.map((t) => this.send(t, [{ key: '_system', value: warmupEnvelope() }], 60)),
    );
  }

  async publish(topic: string, messages: Envelope[]): Promise<void> {
    // Single-topic mode: every logical topic travels over one physical topic, tagged with `_topic`.
    const physical = this.cfg.singleTopic || topic;
    let batch = this.pending.get(physical);
    if (!batch) {
      batch = { records: [], sending: false };
      this.pending.set(physical, batch);
    }
    for (const m of messages) {
      batch.records.push({ key: m.roomId, value: this.cfg.singleTopic ? { ...m, _topic: topic } : m });
    }
    void this.flush(physical, batch);
  }

  private async flush(topic: string, batch: PendingBatch) {
    if (batch.sending) return;
    batch.sending = true;
    try {
      while (batch.records.length && !this.closed) {
        const records = batch.records.splice(0, 200);
        await this.send(topic, records, 3);
      }
    } finally {
      batch.sending = false;
    }
  }

  private async send(topic: string, records: PendingBatch['records'], attempts: number) {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.call(`/topics/${topic}`, {
          method: 'POST',
          headers: { 'Content-Type': JSON_PRODUCE },
          body: JSON.stringify({ records }),
        });
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { offsets?: { error_code?: number }[] } | null;
          const bad = body?.offsets?.find((o) => o.error_code);
          if (!bad) return;
          // HTTP 200 can still carry per-record errors (e.g. 3 = topic not created yet).
          if (process.env.BROKER_DEBUG) console.error(`[broker] publish ${topic} record error ${bad.error_code}`);
        } else {
          console.error(`[broker] publish ${topic} -> ${res.status} ${await res.text()}`);
        }
      } catch (e) {
        console.error(`[broker] publish ${topic} failed`, (e as Error).message);
      }
      await sleep(Math.min(500 * (i + 1), 3000));
    }
    console.error(`[broker] publish ${topic} gave up after ${attempts} attempts`);
  }

  async subscribe(group: string, topics: string[], handler: Handler) {
    const since = Date.now() - 2000;
    let name = '';
    let running = true;
    let created = false;
    let markReady!: () => void;
    const ready = new Promise<void>((r) => (markReady = r));
    const base = `/consumers/${group}`;
    const inst = () => `${base}/instances/${name}`;

    const create = async (): Promise<boolean> => {
      // Fresh name per attempt: a 500 may leave a half-built instance behind.
      name = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const r1 = await this.call(base, {
          method: 'POST',
          headers: { 'Content-Type': KAFKA_V2 },
          body: JSON.stringify({ name, format: 'json', 'auto.offset.reset': 'earliest' }),
        });
        if (!r1.ok) {
          console.error(`[broker] create consumer ${group} -> ${r1.status} ${await r1.text()}`);
          return false;
        }
        const r2 = await this.call(`${inst()}/subscription`, {
          method: 'POST',
          headers: { 'Content-Type': KAFKA_V2 },
          body: JSON.stringify({ topics: this.cfg.singleTopic ? [this.cfg.singleTopic] : topics }),
        });
        if (!r2.ok) {
          console.error(`[broker] subscribe ${group} -> ${r2.status} ${await r2.text()}`);
          return false;
        }
        created = true;
        return true;
      } catch (e) {
        console.error(`[broker] consumer ${group} setup failed`, (e as Error).message);
        return false;
      }
    };

    const loop = async () => {
      let backoff = 500;
      let createDelay = 150;
      while (running && !this.closed) {
        if (!created) {
          if (!(await create())) {
            // The proxy often fails a create immediately; a quick retry usually succeeds.
            await sleep(createDelay + Math.random() * 200);
            createDelay = Math.min(createDelay * 1.5, 2000);
            continue;
          }
          createDelay = 150;
          markReady();
        }
        try {
          const res = await this.call(`${inst()}/records?timeout=1000&max_bytes=1048576`, {
            headers: { Accept: 'application/vnd.kafka.json.v2+json' },
          });
          if (!res.ok) {
            console.error(`[broker] poll ${group} -> ${res.status} ${(await res.text()).slice(0, 120)}`);
            created = false;
            await sleep(backoff);
            backoff = Math.min(backoff * 2, 8000);
            continue;
          }
          backoff = 500;
          const wanted = new Set(topics);
          const records = ((await res.json()) as { topic: string; value: Envelope & { _topic?: string } }[])
            .map((r) => (this.cfg.singleTopic ? { topic: r.value?._topic ?? '', value: r.value } : r))
            .filter((r) => wanted.has(r.topic));
          if (process.env.BROKER_DEBUG && records.length) console.log(`[broker] ${group} polled ${records.length}`);
          for (const rec of records) {
            const env = rec.value;
            if (!env || env.type === 'topic_warmup') continue;
            if (Date.parse(env.timestamp) < since) continue;
            try {
              await handler(rec.topic, env);
            } catch (e) {
              console.error(`[broker] handler ${group} failed`, e);
            }
          }
          if (!records.length) await sleep(20);
        } catch (e) {
          if (!running) break;
          console.error(`[broker] poll ${group} failed`, (e as Error).message);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 8000);
        }
      }
    };
    void loop();
    // Wait for the first successful setup so callers know the consumer is live (bounded).
    await Promise.race([ready, sleep(120_000)]);

    const stop = async () => {
      running = false;
      this.stops.delete(stop);
      if (created) {
        try {
          await this.call(inst(), { method: 'DELETE', headers: { 'Content-Type': KAFKA_V2 } });
        } catch {
          /* ignore */
        }
      }
    };
    this.stops.add(stop);
    return stop;
  }

  async close() {
    await Promise.all([...this.stops].map((s) => s()));
    this.closed = true;
  }
}
