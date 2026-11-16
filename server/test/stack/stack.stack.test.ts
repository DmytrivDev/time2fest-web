/**
 * Stack-level tests (SPEC-02 W24). Require `pnpm stack` serving in another terminal and, for AC-43,
 * `pnpm build:int` done. Run with `pnpm --dir server test:stack`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { REDIS_HOST_PORT, SERVER, envLocal, serverDir, wt } from './env';

const scripts = path.join(serverDir, 'scripts');
const outInt = path.resolve(serverDir, '..', 'out-int');
const SPARE_SLOT = '47';
const children: ChildProcess[] = [];

afterAll(() => {
  for (const c of children) c.kill();
});

function runNode(script: string, args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, [path.join(scripts, script), ...args], {
    cwd: serverDir,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
}

function occupy(port: number, host = '127.0.0.1'): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(port, host, () => resolve(s));
  });
}

async function waitFor(url: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

function startServeInt(env: Record<string, string>): ChildProcess {
  const child = spawn(process.execPath, [path.join(scripts, 'serve-int.mjs')], {
    cwd: serverDir,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  children.push(child);
  return child;
}

describe('stack', () => {
  it('AC-1: GET /api/time answers 200 and no migration is pending', async () => {
    const res = await fetch(`${SERVER}/api/time`);
    expect(res.status).toBe(200);
    const r = spawnSync(process.execPath, [path.join(scripts, 'verify-schema.mjs')], {
      cwd: serverDir,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(r.stdout + r.stderr).not.toMatch(/pending migration/i);
  }, 150_000);

  it('AC-5: stack up without Docker fails with a Docker message before any db-create step', () => {
    const r = runNode('stack.mjs', ['up'], { DOCKER_HOST: 'tcp://127.0.0.1:1', DOCKER_CONTEXT: 'default' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('Docker');
    expect(r.stdout).not.toContain('[stack] db-create');
  });

  it('AC-6: a busy server port stops `serve` with the port number', async () => {
    const busy = await occupy(wt.ports.server).catch(() => null);
    // The stack itself already holds the port: either way the port is busy.
    try {
      const r = runNode('stack.mjs', ['serve'], { T2F_SLOT: String(wt.slot) });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toContain(String(wt.ports.server));
    } finally {
      busy?.close();
    }
  }, 90_000);

  it('AC-6: a busy web port stops `serve-int` with the port number', async () => {
    const busy = await occupy(wt.ports.web);
    try {
      const r = runNode('serve-int.mjs', [], { T2F_SLOT: String(wt.slot) });
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toContain(String(wt.ports.web));
    } finally {
      busy.close();
    }
  });

  it('AC-11: the shared Redis has 64 databases', async () => {
    const redis = new Redis({ host: '127.0.0.1', port: REDIS_HOST_PORT, lazyConnect: true });
    try {
      await redis.connect();
      const r = (await redis.config('GET', 'databases')) as string[];
      expect(r[1]).toBe('64');
    } finally {
      redis.disconnect();
    }
  });

  it('AC-43: serve-int serves index.html and proxies /api/time to the server', async (ctx) => {
    if (!fs.existsSync(path.join(outInt, 'index.html'))) {
      console.warn('AC-43 skipped: out-int is missing, run `pnpm build:int` first');
      ctx.skip();
    }
    startServeInt({ T2F_SLOT: String(wt.slot) });
    const web = `http://127.0.0.1:${wt.ports.web}`;
    await waitFor(`${web}/`);
    const index = await (await fetch(`${web}/`)).text();
    expect(index).toBe(fs.readFileSync(path.join(outInt, 'index.html'), 'utf8'));
    const body = (await (await fetch(`${web}/api/time`)).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['now']);
    expect((await fetch(`${web}/definitely-missing/`)).status).toBe(404);
    expect((await fetch(`${web}/..%2f..%2fpackage.json`)).status).toBe(404);
  }, 30_000);

  it('AC-71: an unreachable upstream gives 502 with an empty body', async () => {
    // Spare slot: the web port of slot 47 serves, its server port has nothing listening.
    const web = 4000 + 10 * Number(SPARE_SLOT) + 1;
    startServeInt({ T2F_SLOT: SPARE_SLOT });
    await waitFor(`http://127.0.0.1:${web}/api/time`);
    const res = await fetch(`http://127.0.0.1:${web}/api/time`);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('');
  }, 30_000);

  it('AC-60: Payload REST answers under /cms-api', async () => {
    const res = await fetch(`${SERVER}/cms-api/admins`);
    expect(res.status).not.toBe(404);
  }, 60_000);

  it('AC-61: the server port refuses non-loopback addresses', async (ctx) => {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    if (ips.length === 0) ctx.skip();
    for (const ip of ips) {
      const outcome = await new Promise<string>((resolve) => {
        const s = net.connect({ host: ip, port: wt.ports.server });
        const t = setTimeout(() => {
          s.destroy();
          resolve('timeout');
        }, 3000);
        s.on('connect', () => {
          clearTimeout(t);
          s.destroy();
          resolve('connected');
        });
        s.on('error', (e: NodeJS.ErrnoException) => {
          clearTimeout(t);
          resolve(e.code ?? 'error');
        });
      });
      expect(['ECONNREFUSED', 'timeout']).toContain(outcome);
    }
  });

  it('NFR-7: the admin session cookie is HttpOnly and SameSite=Lax', async () => {
    Object.assign(process.env, envLocal);
    const { getPayload } = await import('payload');
    const { default: config } = await import('../../src/payload.config');
    const payload = await getPayload({ config });
    const email = `t+${wt.slug}@example.com`;
    const password = `pw-${Math.random().toString(36).slice(2)}-Aa1!`;
    const admin = await payload.create({ collection: 'admins', data: { email, password }, overrideAccess: true });
    try {
      const res = await fetch(`${SERVER}/cms-api/admins/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${wt.ports.web}` },
        body: JSON.stringify({ email, password }),
      });
      expect(res.status).toBe(200);
      const cookie = res.headers.getSetCookie().join('\n');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toMatch(/SameSite=Lax/i);
    } finally {
      await payload.delete({ collection: 'admins', id: admin.id, overrideAccess: true });
    }
  }, 60_000);

  // The 50 ms budget is for a production build; `next dev` compiles on demand and adds its own overhead.
  // Run it against `pnpm --dir server start:prod` with T2F_SERVER_MODE=start.
  const nfr8 = process.env.T2F_SERVER_MODE === 'start' ? it : it.skip;
  nfr8('NFR-8 (production build only: set T2F_SERVER_MODE=start): 1000 sequential GET /api/time have p95 <= 50 ms', async () => {
    const times: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const t0 = performance.now();
      const res = await fetch(`${SERVER}/api/time`);
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThanOrEqual(50);
  }, 120_000);
});
