/**
 * Edge Worker for the red-button e2e (SPEC-08, AC-44): the real `workers/edge` code in `createTestHarness`, serving the
 * integration build (`out-int`) as ASSETS, with a forwarding origin in front of the local server that the spec can
 * stop (the real server is never stopped). The R2 bucket is the harness' local one: the spec puts the red-button
 * object through `getEnv().SITE_BUCKET`, exactly what the owner action does in production.
 *
 * Needs: T2F_E2E_SERVER (the local server), the integration build in `out-int`, and the server's edge secret in
 * T2F_EDGE_SECRET (the origin accepts edge traffic only with it). Not run by the unit suites.
 */
import { createRequire } from 'node:module';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SITE_R2_KEYS } from '../../../packages/contracts/src/site';
import { writeTempConfig } from '../../../workers/edge/test/support/tempConfig';

const ROOT = process.cwd();
const EDGE_DIR = path.join(ROOT, 'workers', 'edge');
const PREFIX = 'e2e_site_state/';
const ENV = 'test';

interface Bucket {
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}
interface Harness {
  listen(): Promise<{ url: URL }>;
  close(): Promise<void>;
  fetch(input: string, init?: Record<string, unknown>): Promise<Response>;
  getWorker<E>(): { getEnv(): Promise<E> };
}
type CreateHarness = (opts: { workers: { configPath: string; env: string; secrets: Record<string, string> }[] }) => Harness;

export interface Edge {
  /** Base URL of the edge in front of the integration build. */
  url: string;
  /** Closes the forwarding origin: from now on the edge's origin requests are refused (the server "is stopped"). */
  stopOrigin(): Promise<void>;
  /** Writes `<prefix>site/red-button.json` (the current snapshot with `outage: 'technical'`) into the edge's bucket. */
  putRedButton(): Promise<void>;
  close(): Promise<void>;
}

/** Plain forwarder to the real server; `close()` makes the next connection fail like a stopped origin. */
function startForwarder(target: URL): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const up = httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

async function loadHarness(): Promise<CreateHarness> {
  const entry = createRequire(path.join(EDGE_DIR, 'package.json')).resolve('wrangler');
  const mod = (await import(pathToFileURL(entry).href)) as { createTestHarness: CreateHarness };
  return mod.createTestHarness;
}

export async function startEdge(opts: { server: string; secret: string; assetsDir?: string }): Promise<Edge> {
  const forwarder = await startForwarder(new URL(opts.server));
  const cfg = writeTempConfig(forwarder.url, 'e2e-site-state', { env: ENV, prefix: PREFIX });
  // The temp config points assets at the unit-test fixture site: aim it at the integration build.
  const raw = JSON.parse(readFileSync(cfg.configPath, 'utf8')) as { env: Record<string, { assets: { directory: string } }> };
  raw.env[ENV]!.assets.directory = path.resolve(ROOT, opts.assetsDir ?? 'out-int');
  writeFileSync(cfg.configPath, JSON.stringify(raw, null, 2));

  const harness = (await loadHarness())({ workers: [{ configPath: cfg.configPath, env: ENV, secrets: { T2F_EDGE_SECRET: opts.secret } }] });
  const { url } = await harness.listen();
  let originOpen = true;
  const stopOrigin = async () => {
    if (!originOpen) return;
    originOpen = false;
    await new Promise<void>((resolve) => {
      forwarder.server.closeAllConnections();
      forwarder.server.close(() => resolve());
    });
  };
  return {
    url: url.origin,
    stopOrigin,
    async putRedButton() {
      const res = await harness.fetch('/api/site/state', { cf: { country: 'UA' } });
      const body = (await res.json()) as Record<string, unknown>;
      const snapshot = (body.value as Record<string, unknown> | undefined) ?? body; // bare snapshot, or an envelope
      const env = await harness.getWorker<{ SITE_BUCKET: Bucket }>().getEnv();
      await env.SITE_BUCKET.put(`${PREFIX}${SITE_R2_KEYS.redButton}`, JSON.stringify({ ...snapshot, outage: 'technical' }));
    },
    async close() {
      await harness.close();
      await stopOrigin();
      cfg.cleanup();
    },
  };
}
