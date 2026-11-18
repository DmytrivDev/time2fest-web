/**
 * SPEC-06 publish port and `invalidateSubject` without Centrifugo (AC-31, NFR-5), plus the outcome
 * mapping of the Centrifugo HTTP API adapter over a stubbed `fetch` (AC-32, AC-36, AC-17).
 */
import { randomBytes } from 'node:crypto';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCentrifugoApi } from '../../src/adapters/centrifugoApi';
import type { CentrifugoApi, CentrifugoPublishInput, PublishOutcome } from '../../src/realtime/ports';
import { createSubjectInvalidator } from '../../src/realtime/invalidate';
import { createChannelPublisher } from '../../src/realtime/publisher';
import { channelClassesFor } from '../../src/registries/channels';

// Built at runtime: no secret-looking literal in the test.
const API_KEY = randomBytes(24).toString('hex');
const PREFIX = 'unit_test_';
const rows = channelClassesFor('test');
/** The batcher's timers never fire here: these cases use unbatched classes (batching: realtime-batch.test.ts). */
const timing = {
  scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
  clock: { now: () => 0 },
  makeId: () => 'batch-id-000000000000000000000000000',
};

type Line = { level: 'info' | 'warn' | 'error'; fields: Record<string, unknown> };

function capture() {
  const lines: Line[] = [];
  return {
    lines,
    log: {
      info: (fields: Record<string, unknown>) => lines.push({ level: 'info', fields }),
      warn: (fields: Record<string, unknown>) => lines.push({ level: 'warn', fields }),
      error: (fields: Record<string, unknown>) => lines.push({ level: 'error', fields }),
    },
  };
}

function stubApi(outcome: PublishOutcome = { status: 'ok', offset: 1, epoch: 'e' }, disconnect: 'ok' | 'unavailable' = 'ok') {
  const publishes: CentrifugoPublishInput[] = [];
  const disconnects: unknown[][] = [];
  const api: CentrifugoApi = {
    publish: (input) => {
      publishes.push(input);
      return Promise.resolve(outcome);
    },
    disconnectUser: (...args) => {
      disconnects.push(args);
      return Promise.resolve(disconnect);
    },
  };
  return { api, publishes, disconnects };
}

/** An envelope whose JSON serialization is exactly `bytes` bytes long. */
function envelopeOfSize(bytes: number): RealtimeEnvelope {
  const base = JSON.stringify({ type: 't', id: 'big', data: '' }).length;
  return { type: 't', id: 'big', data: 'a'.repeat(bytes - base) };
}

const env: RealtimeEnvelope = { type: 'site.state', id: 'ev-1', version: 3, data: { phase: 'live' } };

describe('publish port: validation (AC-31)', () => {
  it('an unknown class → validation, 0 API calls, one warn line', async () => {
    const { api, publishes } = stubApi();
    const { log, lines } = capture();
    const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log, ...timing });
    expect(await publisher.publish('nope:class', undefined, env)).toEqual({ status: 'validation' });
    expect(publishes).toHaveLength(0);
    expect(lines).toEqual([{ level: 'warn', fields: { event: 'realtime_publish', class: 'nope:class', events: 1, result: 'validation' } }]);
  });

  it('an envelope without id → validation, 0 API calls', async () => {
    const { api, publishes } = stubApi();
    const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log: capture().log, ...timing });
    const noId = { type: 'site.state', data: {} } as unknown as RealtimeEnvelope;
    expect(await publisher.publish('site:state', undefined, noId)).toEqual({ status: 'validation' });
    expect(publishes).toHaveLength(0);
  });

  it('a 65 537-byte envelope → validation, 0 API calls; 65 536 bytes is published', async () => {
    const { api, publishes } = stubApi();
    const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log: capture().log, ...timing });
    const over = envelopeOfSize(65_537);
    expect(Buffer.byteLength(JSON.stringify(over))).toBe(65_537);
    expect(await publisher.publish('site:state', undefined, over)).toEqual({ status: 'validation' });
    expect(publishes).toHaveLength(0);
    expect((await publisher.publish('site:state', undefined, envelopeOfSize(65_536))).status).toBe('ok');
    expect(publishes).toHaveLength(1);
  });

  it('a bad key (key on a fixed class, bad country) → validation, 0 API calls', async () => {
    const { api, publishes } = stubApi();
    const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log: capture().log, ...timing });
    expect((await publisher.publish('site:state', 'UA', env)).status).toBe('validation');
    expect((await publisher.publish('chat:country', 'ua:x', env)).status).toBe('validation');
    expect(publishes).toHaveLength(0);
  });

  it('a valid publish → the prefixed channel, the envelope as data, its id as idempotency key; no log line', async () => {
    const { api, publishes } = stubApi();
    const { log, lines } = capture();
    const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log, ...timing });
    // `chat:country` is batched since W30 (it returns `queued`); a keyed unbatched class keeps the immediate path.
    expect(await publisher.publish('notif', 'u1', env)).toEqual({ status: 'ok', offset: 1, epoch: 'e' });
    expect(publishes).toEqual([{ channel: `notif:${PREFIX}user#u1`, data: env, idempotencyKey: 'ev-1' }]);
    expect(lines).toEqual([]);
  });
});

describe('warn lines carry no body, token or key (NFR-5)', () => {
  it('unavailable and rejected publish → unavailable, one warn line each with class, events, result', async () => {
    for (const outcome of [{ status: 'unavailable' }, { status: 'rejected', code: 102 }] as const) {
      const { api } = stubApi(outcome);
      const { log, lines } = capture();
      const publisher = createChannelPublisher({ api, rows, prefix: PREFIX, log, ...timing });
      expect(await publisher.publish('site:state', undefined, env)).toEqual({ status: 'unavailable' });
      expect(lines).toHaveLength(1);
      expect(lines[0]?.level).toBe('warn');
      expect(lines[0]?.fields).toMatchObject({ event: 'realtime_publish', class: 'site:state', events: 1, result: 'unavailable' });
      expect(Object.keys(lines[0]?.fields ?? {})).not.toContain('data');
      expect(JSON.stringify(lines)).not.toContain('phase');
    }
  });

  it('a throwing API never reaches domain code', async () => {
    const api: CentrifugoApi = { publish: () => Promise.reject(new Error('boom')), disconnectUser: () => Promise.reject(new Error('boom')) };
    const { log, lines } = capture();
    await expect(createChannelPublisher({ api, rows, prefix: PREFIX, log, ...timing }).publish('site:state', undefined, env)).resolves.toEqual({ status: 'unavailable' });
    await expect(createSubjectInvalidator({ api, log }).invalidate('s1')).resolves.toBe('unavailable');
    expect(lines.filter((l) => l.level === 'warn')).toHaveLength(2);
  });

  it('invalidate → disconnect with 3014; unavailable → one warn line with the subject id', async () => {
    const ok = stubApi(undefined, 'ok');
    const okLog = capture();
    expect(await createSubjectInvalidator({ api: ok.api, log: okLog.log }).invalidate('s1')).toBe('ok');
    expect(ok.disconnects).toEqual([['s1', 3014, 'state invalidated']]);
    expect(okLog.lines).toEqual([]);

    const down = stubApi(undefined, 'unavailable');
    const { log, lines } = capture();
    expect(await createSubjectInvalidator({ api: down.api, log }).invalidate('s1')).toBe('unavailable');
    expect(lines).toEqual([{ level: 'warn', fields: { event: 'realtime_invalidate', subject: 's1', result: 'unavailable' } }]);
  });
});

describe('Centrifugo HTTP API adapter (AC-32, AC-36, AC-17)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(reply: () => Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply();
    });
    return calls;
  }

  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const input = { channel: 'site:state', data: env, idempotencyKey: 'ev-1' };

  it('publish sends channel, data, idempotency_key with X-API-Key and a timeout; 200 result → ok', async () => {
    const calls = stubFetch(() => json({ result: { offset: 7, epoch: 'xyz' } }));
    const api = createCentrifugoApi({ url: 'http://centrifugo.test/', apiKey: API_KEY, log: capture().log });
    expect(await api.publish(input)).toEqual({ status: 'ok', offset: 7, epoch: 'xyz' });
    expect(calls[0]?.url).toBe('http://centrifugo.test/api/publish');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ channel: 'site:state', data: env, idempotency_key: 'ev-1' });
    expect((calls[0]?.init.headers as Record<string, string>)['X-API-Key']).toBe(API_KEY);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('200 with error → rejected; 401, 500, a network error, a non-JSON body → unavailable; never throws', async () => {
    const { log, lines } = capture();
    const api = createCentrifugoApi({ url: 'http://centrifugo.test', apiKey: API_KEY, log });
    stubFetch(() => json({ error: { code: 102, message: 'unknown channel' } }));
    expect(await api.publish(input)).toEqual({ status: 'rejected', code: 102 });
    stubFetch(() => json({}, 401));
    expect(await api.publish(input)).toEqual({ status: 'unavailable' });
    stubFetch(() => json({}, 500));
    expect(await api.publish(input)).toEqual({ status: 'unavailable' });
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    expect(await api.publish(input)).toEqual({ status: 'unavailable' });
    stubFetch(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await api.publish(input)).toEqual({ status: 'unavailable' });
    expect(lines).toEqual([{ level: 'error', fields: { event: 'realtime_api_key_refused', method: 'publish' } }]);
    expect(JSON.stringify(lines)).not.toContain(API_KEY);
  });

  it('disconnectUser sends user and {code, reason}; 200 → ok, 5xx or network error → unavailable', async () => {
    const calls = stubFetch(() => json({ result: {} }));
    const api = createCentrifugoApi({ url: 'http://centrifugo.test', apiKey: API_KEY, log: capture().log });
    expect(await api.disconnectUser('s1', 3014, 'state invalidated')).toBe('ok');
    expect(calls[0]?.url).toBe('http://centrifugo.test/api/disconnect');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ user: 's1', disconnect: { code: 3014, reason: 'state invalidated' } });
    stubFetch(() => json({}, 503));
    expect(await api.disconnectUser('s1', 3014, 'x')).toBe('unavailable');
    stubFetch(() => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    expect(await api.disconnectUser('s1', 3014, 'x')).toBe('unavailable');
  });
});
