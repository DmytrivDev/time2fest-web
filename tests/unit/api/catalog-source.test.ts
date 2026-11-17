import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CatalogResponseSchema } from '@time2fest/contracts/schemas';
import { checkCatalogUrl, fetchCatalogTo, resolveCatalogSource } from '@/lib/data/catalogSource.mjs';
import { getService } from '@/lib/api/services';

const NO_FILE = path.join(os.tmpdir(), 'no-such-t2f-env-file');
const readData = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', name), 'utf8'));
/** A real, schema-valid catalog payload (data/ is only read). */
const VALID = { version: 'v1', schedule: readData('schedule.json'), countries: readData('countries.json') };

describe('resolveCatalogSource', () => {
  it('test + http: T2F_CATALOG_URL, else the port from the env, else the env file', () => {
    expect(resolveCatalogSource({ testBuild: true, apiMode: 'http', env: { T2F_CATALOG_URL: 'http://127.0.0.1:1/' }, envFile: NO_FILE })).toEqual({ url: 'http://127.0.0.1:1' });
    expect(resolveCatalogSource({ testBuild: true, apiMode: 'http', env: { T2F_SERVER_PORT: '4123' }, envFile: NO_FILE })).toEqual({ url: 'http://127.0.0.1:4123' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-env-'));
    const file = path.join(dir, '.env.local');
    fs.writeFileSync(file, 'A=1\nT2F_SERVER_PORT=4777\n');
    expect(resolveCatalogSource({ testBuild: true, apiMode: 'http', env: {}, envFile: file })).toEqual({ url: 'http://127.0.0.1:4777' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('production + http: the URL only when T2F_CATALOG_URL is set, else data/', () => {
    expect(resolveCatalogSource({ testBuild: false, apiMode: 'http', env: { T2F_CATALOG_URL: 'https://s' }, envFile: NO_FILE })).toEqual({ url: 'https://s' });
    expect(resolveCatalogSource({ testBuild: false, apiMode: 'http', env: {}, envFile: NO_FILE })).toBe('data');
  });

  it('sim (the demo and the unit tests) always reads data/', () => {
    expect(resolveCatalogSource({ testBuild: true, apiMode: 'sim', env: { T2F_CATALOG_URL: 'http://s' }, envFile: NO_FILE })).toBe('data');
    expect(resolveCatalogSource({ testBuild: false, apiMode: 'sim', env: {}, envFile: NO_FILE })).toBe('data');
  });
});

describe('T2F_CATALOG_URL scheme (S4-03)', () => {
  it('a production build refuses http:, even on loopback; https: passes', () => {
    expect(() => resolveCatalogSource({ testBuild: false, apiMode: 'http', env: { T2F_CATALOG_URL: 'http://catalog.example.com' }, envFile: NO_FILE })).toThrow(/must use https:/);
    expect(() => checkCatalogUrl('http://127.0.0.1:4000', false)).toThrow(/must use https:/);
    expect(() => checkCatalogUrl('https://catalog.example.com', false)).not.toThrow();
  });

  it('a test build allows http: on loopback only; other schemes and junk fail', () => {
    for (const ok of ['http://127.0.0.1:4000', 'http://localhost:4000/', 'http://[::1]:4000', 'https://catalog.example.com']) {
      expect(() => checkCatalogUrl(ok, true), ok).not.toThrow();
    }
    expect(() => resolveCatalogSource({ testBuild: true, apiMode: 'http', env: { T2F_CATALOG_URL: 'http://catalog.example.com' }, envFile: NO_FILE })).toThrow(/http: to 127\.0\.0\.1/);
    expect(() => checkCatalogUrl('file:///etc/hosts', true)).toThrow(/got file:/);
    expect(() => checkCatalogUrl('not a url', true)).toThrow(/not a valid URL/);
  });
});

describe('fetchCatalogTo', () => {
  let server: http.Server | null = null;
  let out: string | null = null;
  afterEach(async () => {
    const s = server;
    server = null;
    if (s?.listening) await new Promise((r) => s.close(r));
    if (out) fs.rmSync(out, { recursive: true, force: true });
    out = null;
  });

  async function serve(status: number, body: unknown): Promise<string> {
    const s = http.createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server = s;
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  }

  it('ok: writes schedule.json and countries.json and returns the version', async () => {
    const url = await serve(200, { ok: true, value: VALID });
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).resolves.toEqual({ version: 'v1' });
    expect(JSON.parse(fs.readFileSync(path.join(out, 'schedule.json'), 'utf8'))).toEqual(VALID.schedule);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'countries.json'), 'utf8'))).toEqual(VALID.countries);
  });

  it('S4-03: an extra key fails the build, naming its path, and writes nothing', async () => {
    const url = await serve(200, { ok: true, value: { ...VALID, schedule: { ...VALID.schedule, injected: '<script>' } } });
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).rejects.toThrow(/→ invalid response at value\.schedule: .*injected/);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('S4-03: an extra top-level key fails at (root)', async () => {
    const url = await serve(200, { ok: true, value: VALID, debug: 1 });
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).rejects.toThrow(/invalid response at \(root\): .*debug/);
  });

  it('S4-03: a wrong type fails the build, naming the first failing path, and writes nothing', async () => {
    const zones = VALID.schedule.zones.map((z: { offsetMinutes: number }, i: number) => (i === 3 ? { ...z, offsetMinutes: '120' } : z));
    const url = await serve(200, { ok: true, value: { ...VALID, schedule: { ...VALID.schedule, zones } } });
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).rejects.toThrow(/invalid response at value\.schedule\.zones\.3\.offsetMinutes: /);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('S4-03: ok:false with a valid error reports its code and writes nothing', async () => {
    const url = await serve(200, { ok: false, error: { code: 'unavailable' } });
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).rejects.toThrow(`catalog: ${url}/api/catalog → unavailable`);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('503: throws with the URL and the status, writes nothing', async () => {
    const url = await serve(503, { ok: false, error: { code: 'unavailable' } });
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).rejects.toThrow(`catalog: ${url}/api/catalog → 503`);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it('connection refused: throws with the URL', async () => {
    const url = await serve(200, {});
    const s = server!;
    server = null;
    await new Promise((r) => s.close(r));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cat-'));
    await expect(fetchCatalogTo(out, url, CatalogResponseSchema)).rejects.toThrow(`catalog: ${url}/api/catalog → `);
  });
});

describe('catalog version in a built bundle', () => {
  it('equals NEXT_PUBLIC_CATALOG_VERSION when it is set', () => {
    const inlined = process.env.NEXT_PUBLIC_CATALOG_VERSION;
    if (!inlined) return;
    expect(getService('catalog').version()).toBe(inlined);
  });
});
