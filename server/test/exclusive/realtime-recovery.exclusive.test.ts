/**
 * SPEC-06 recovery when the shared Centrifugo loses its state (AC-42 (b), AC-43). Runs only under the
 * machine's exclusive integration lock (`T2F_EXCLUSIVE=1 … --mode exclusive`): it flushes Centrifugo's
 * Redis database and restarts the shared `centrifugo` container of the `t2f` compose project (never
 * recreates it), so no other worktree may be testing meanwhile. The compose child gets the two shared
 * secrets through `ensureRealtimeSecrets`; they, the tokens and the API key are never printed.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createRealtimeTransport, type RealtimeFetch } from '../../../lib/api/http/realtime/transport';
import type { RealtimeTransport } from '../../../lib/api/http/realtime/types';
import { ensureRealtimeSecrets, realtimeSecretsFile } from '../../scripts/lib/realtimeSecrets.mjs';
import { buildDispatcher } from '../../src/container';
import { publisherOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { BASE, ownRedis, testDeps } from '../integration/helpers';
import { startRealtimeProxy, type RealtimeProxy } from '../integration/realtime-proxy';
import { describeRealtime, name, realtimeEnv, websocketUrl } from '../integration/realtime-support';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '../..');
const COMPOSE_FILE = path.resolve(SERVER_DIR, '../docker-compose.yml');
/** Centrifugo's Redis database, read from the compose file so the test cannot drift from it. */
const CENTRIFUGO_DB = /CENTRIFUGO_ENGINE_REDIS_ADDRESS:\s*'redis:\/\/[^/']+\/(\d+)'/.exec(
  fs.readFileSync(COMPOSE_FILE, 'utf8'),
)?.[1];
const RL_PREFIX = 'rl:realtime-token:';
/** Long enough for `docker compose exec … FLUSHDB` and the publishes to land inside the pause. */
const PAUSE_MS = 8_000;
const RECOVERY_WAIT_MS = 45_000;

const composeEnv = { ...process.env, ...ensureRealtimeSecrets(realtimeSecretsFile(SERVER_DIR, process.env)) };

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '-p', 't2f', '-f', COMPOSE_FILE, ...args], {
    stdio: 'pipe',
    timeout: 120_000,
    encoding: 'utf8',
    env: composeEnv,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = (p: string) => `${p}${randomBytes(6).toString('hex')}`;

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (pred()) return true;
    await sleep(50);
  }
  return pred();
}

/** Waits until the (restarted, same) container reports healthy. */
async function healthy(service: string): Promise<void> {
  const id = compose('ps', '-q', service).trim();
  for (let i = 0; i < 120; i += 1) {
    const health = execFileSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', id], { encoding: 'utf8' }).trim();
    if (health === 'healthy') return;
    await sleep(500);
  }
  throw new Error(`${service} did not become healthy`);
}

const redis = ownRedis();
let deps: Deps;
let dispatch: (r: Request) => Promise<Response>;
let proxy: RealtimeProxy;
const stops: (() => void)[] = [];

const tokenFetch: RealtimeFetch = (input) => dispatch(new Request(new URL(input, BASE)));

function openTransport(): RealtimeTransport {
  return createRealtimeTransport({
    url: websocketUrl(`http://127.0.0.1:${proxy.port}`),
    tokenUrl: '/api/realtime/token',
    fetch: tokenFetch,
    loadCentrifuge: () => import('centrifuge'),
  });
}

interface Probe {
  events: RealtimeEnvelope[];
  resyncs: number;
}

function listen(transport: RealtimeTransport, channel: string): Probe {
  const probe: Probe = { events: [], resyncs: 0 };
  stops.push(
    transport.subscribe(channel, {
      onEvent: (event) => probe.events.push(event),
      onResync: () => {
        probe.resyncs += 1;
      },
    }),
  );
  return probe;
}

const counterOf = (e: RealtimeEnvelope) => (e.data as { n: number }).n;
const counted = (probe: Probe) => probe.events.map(counterOf).filter((n) => n > 0);

/** Publishes counter `n` into `site:state`; retries while Centrifugo is coming back (`unavailable`). */
async function publishSite(n: number): Promise<RealtimeEnvelope> {
  const envelope: RealtimeEnvelope = { type: 'site.state', id: uid('ev_'), data: { n } };
  for (let i = 0; i < 20; i += 1) {
    const { status } = await publisherOf(deps).publish('site:state', undefined, envelope);
    if (status === 'ok') return envelope;
    expect(status).toBe('unavailable');
    await sleep(500);
  }
  throw new Error('site:state publish stayed unavailable');
}

/** Subscribes and proves the subscription live with a warm-up event (counter 0). */
async function subscribed(transport: RealtimeTransport): Promise<Probe> {
  const probe = listen(transport, name('site:state'));
  let arrived = false;
  for (let i = 0; i < 5 && !arrived; i += 1) {
    const warm = await publishSite(0);
    arrived = await waitFor(() => probe.events.some((e) => e.id === warm.id), 2_000);
  }
  expect(arrived).toBe(true);
  return probe;
}

describeRealtime('realtime recovery when Centrifugo loses state (exclusive lock)', () => {
  beforeAll(async () => {
    expect(CENTRIFUGO_DB).toBeDefined();
    deps = testDeps({ redis });
    dispatch = await buildDispatcher(deps);
    proxy = await startRealtimeProxy(realtimeEnv.url ?? '');
  });

  beforeEach(async () => {
    await redis.deleteByPrefix(RL_PREFIX);
  });

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    proxy.pause(0);
  });

  afterAll(async () => {
    await proxy.close();
    await redis.deleteByPrefix(RL_PREFIX);
    await redis.close();
  });

  it('AC-42 (b): Centrifugo Redis flushed during the drop → one onResync, none of the missed events', { timeout: 120_000 }, async () => {
    const transport = openTransport();
    const probe = await subscribed(transport);

    proxy.pause(PAUSE_MS);
    proxy.drop();
    compose('exec', '-T', 'redis', 'redis-cli', '-n', CENTRIFUGO_DB ?? '', 'FLUSHDB');
    const missed: string[] = [];
    for (let n = 1; n <= 3; n += 1) missed.push((await publishSite(n)).id);

    expect(await waitFor(() => probe.resyncs > 0, RECOVERY_WAIT_MS)).toBe(true);
    await sleep(1_500);
    expect(probe.resyncs).toBe(1);
    expect(probe.events.map((e) => e.id).filter((id) => missed.includes(id))).toEqual([]);
    expect(transport.state()).toBe('connected');
  });

  it('AC-43: the centrifugo container restarted mid-subscription → every event in order, or exactly one onResync', { timeout: 300_000 }, async () => {
    const transport = openTransport();
    const probe = await subscribed(transport);
    for (let n = 1; n <= 3; n += 1) await publishSite(n);
    expect(await waitFor(() => counted(probe).length === 3, 10_000)).toBe(true);

    compose('restart', 'centrifugo');
    await healthy('centrifugo');
    for (let n = 4; n <= 6; n += 1) await publishSite(n);

    const all = [1, 2, 3, 4, 5, 6];
    expect(await waitFor(() => probe.resyncs > 0 || counted(probe).length >= all.length, RECOVERY_WAIT_MS)).toBe(true);
    await sleep(1_500);
    expect(transport.state()).toBe('connected');
    if (probe.resyncs === 0) {
      // Recovered from the known offsets: nothing missing, nothing twice, publication order.
      expect(counted(probe)).toEqual(all);
    } else {
      // Not recovered: exactly one resync, and what was delivered never skips a counter silently.
      expect(probe.resyncs).toBe(1);
      expect(counted(probe).slice(0, 3)).toEqual([1, 2, 3]);
      const rest = counted(probe).slice(3);
      expect(rest).toEqual([...new Set(rest)].sort((a, b) => a - b));
      expect(rest.every((n) => n >= 4 && n <= 6)).toBe(true);
    }
  });
});
