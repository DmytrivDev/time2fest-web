/**
 * Internal events across server instances (AC-40, AC-41): two separate Node processes, each with
 * its own container, Postgres pool and event bus, against the same `_test` database. This process
 * is instance A (it publishes); instance B is a child process (`support/events-instance.ts`).
 * An event committed in A reaches the subscribers of both within 2 s with the same version; a
 * rolled-back one reaches neither within 3 s. Runs under `pnpm --dir server test:int:exclusive`.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitTransaction, createLocalReq, initTransaction, killTransaction, type Payload, type PayloadRequest } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsOf, payloadOf, startBackground } from '../../src/container';
import type { EventBus } from '../../src/events/bus';
import type { Deps } from '../../src/endpoints/types';
import type { InternalEvent } from '../../src/events/ports';
import { recordedEvents } from '../../src/registries/subscribers';
import { testDeps } from '../integration/helpers';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = `${Date.now()}`;
const prefix = `test.two.${run}.`;

async function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(20);
  }
  return predicate();
}

describe('internal events across two instances (AC-40, AC-41)', () => {
  let deps: Deps;
  let payload: Payload;
  let bus: EventBus;
  let child: ChildProcessWithoutNullStreams;
  const childEvents: (InternalEvent & { receivedAt: number })[] = [];

  const inA = (topic: string) => recordedEvents().filter((e) => e.topic === topic);
  const inB = (topic: string) => childEvents.filter((e) => e.topic === topic);

  async function inTransaction(fn: (req: PayloadRequest) => Promise<void>, outcome: 'commit' | 'rollback'): Promise<void> {
    const req = await createLocalReq({}, payload);
    await initTransaction(req);
    await fn(req);
    if (outcome === 'commit') await commitTransaction(req);
    else await killTransaction(req);
  }

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    bus = await startBackground(deps);
    child = spawn(process.execPath, [path.join(serverDir, 'node_modules/tsx/dist/cli.mjs'), 'test/exclusive/support/events-instance.ts', prefix], {
      cwd: serverDir,
      env: process.env,
      stdio: 'pipe',
    });
    let ready!: () => void;
    let failed!: (e: Error) => void;
    const started = new Promise<void>((res, rej) => {
      ready = res;
      failed = rej;
    });
    let buffer = '';
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.stdout.on('data', (c: Buffer) => {
      buffer += c.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === 'READY') ready();
        else if (line.startsWith('EVENT ')) childEvents.push(JSON.parse(line.slice(6)) as InternalEvent & { receivedAt: number });
      }
    });
    child.on('exit', (code) => failed(new Error(`instance B exited (${code}) before READY: ${stderr.slice(-500)}`)));
    await started;
  }, 90_000);

  afterAll(async () => {
    child?.stdin.end();
    await new Promise<void>((res) => {
      if (!child || child.exitCode !== null) return res();
      child.once('exit', () => res());
      setTimeout(() => {
        child.kill();
        res();
      }, 10_000);
    });
    await bus.stop();
  });

  it('AC-40: an event committed in A reaches the subscribers of A and of B within 2 s, with one version', async () => {
    const topic = `${prefix}commit`;
    for (const n of [1, 2]) {
      await inTransaction(async (req) => {
        await eventsOf(deps).publisher.publish(req, topic, { n });
      }, 'commit');
      const committed = Date.now();
      expect(await waitFor(() => inA(topic).length === n && inB(topic).length === n, 2_000)).toBe(true);
      const receivedB = inB(topic)[n - 1]?.receivedAt ?? Infinity;
      console.info(`AC-40 delivery n=${n}: B received ${receivedB - committed} ms after commit`);
      expect(receivedB - committed).toBeLessThanOrEqual(2_000);
    }
    expect(inB(topic).map((e) => e.version)).toEqual([1, 2]);
    expect(inA(topic).map((e) => e.version)).toEqual([1, 2]);
    expect(inB(topic).map((e) => e.id)).toEqual(inA(topic).map((e) => e.id));
    expect(inB(topic)[1]?.payload).toEqual({ n: 2 });
  });

  it('AC-41: an event of a transaction rolled back in A reaches neither instance within 3 s', async () => {
    const topic = `${prefix}rollback`;
    await inTransaction(async (req) => {
      await eventsOf(deps).publisher.publish(req, topic, { lost: true });
    }, 'rollback');
    await sleep(3_000);
    expect(inA(topic)).toHaveLength(0);
    expect(inB(topic)).toHaveLength(0);
  });
});
