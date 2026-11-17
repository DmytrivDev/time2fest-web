/**
 * Live e2e against the real edge (SPEC-05 W26; AC-2, AC-9, AC-46 … AC-51, NFR-1 warm-up).
 * Env: T2F_LIVE_SITE, T2F_LIVE_TUNNEL_HOST, T2F_LIVE_MODE = normal | server-down | tunnel-down | under-attack,
 * T2F_LIVE_COUNTRY_PATH (default: first `/country/<slug>/` of the `out-edge-test` build).
 * Prints `EVIDENCE` lines (status, selected headers, hashes) and never a secret, a raw IP or the fingerprint.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNAVAILABLE_BODY } from '../src/responses';

const SITE = (process.env.T2F_LIVE_SITE ?? '').replace(/\/+$/, '');
const TUNNEL = (process.env.T2F_LIVE_TUNNEL_HOST ?? '').replace(/\/+$/, '');
const MODE = process.env.T2F_LIVE_MODE ?? 'normal';
const ECHO = '/api/_test/edge-echo';
const COOKIE_RE = /^t2f_edge_probe=[0-9a-f]{32}; Path=\/; Secure; HttpOnly; SameSite=Lax$/;

function countryPath(): string {
  const fromEnv = process.env.T2F_LIVE_COUNTRY_PATH;
  if (fromEnv) return fromEnv;
  const dir = resolve(process.cwd(), '../../out-edge-test/country');
  if (existsSync(dir)) {
    const slug = readdirSync(dir).find((name) => !name.includes('.'));
    if (slug) return `/country/${slug}/`;
  }
  throw new Error('set T2F_LIVE_COUNTRY_PATH: no out-edge-test/country build found');
}

const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const evidence = (id: string, fields: Record<string, string | number | boolean | null>): void => {
  console.log(`EVIDENCE ${id} ${JSON.stringify(fields)}`);
};
const hdr = (res: Response, name: string): string | null => res.headers.get(name);

interface EchoValue {
  edgeVerified: boolean;
  client: { country: string | null; addressPresent: boolean };
  probeCookie: string | null;
  bodySha256: string;
  headers: Record<string, string>;
}
async function echoOf(res: Response): Promise<EchoValue> {
  const body = (await res.json()) as { ok: boolean; value: EchoValue };
  expect(body.ok).toBe(true);
  return body.value;
}
async function traceLoc(): Promise<string> {
  const text = await (await fetch(`${SITE}/cdn-cgi/trace`)).text();
  const loc = /^loc=(\S+)$/m.exec(text)?.[1];
  expect(loc, 'cdn-cgi/trace has loc').toBeTruthy();
  return loc as string;
}

describe.skipIf(!SITE)('live edge', () => {
  describe.skipIf(MODE !== 'normal')('mode normal', () => {
    it('AC-46: the probe cookie is set with exact attributes and returned', async () => {
      const first = await fetch(`${SITE}${ECHO}`);
      expect(first.status).toBe(200);
      const setCookie = first.headers.getSetCookie();
      expect(setCookie).toHaveLength(1);
      const line = setCookie[0] as string;
      expect(line).toMatch(COOKIE_RE);
      expect(line.toLowerCase()).not.toContain('domain=');
      const pair = line.split(';')[0] as string;
      const second = await echoOf(await fetch(`${SITE}${ECHO}`, { headers: { cookie: pair } }));
      expect(`t2f_edge_probe=${second.probeCookie}`).toBe(pair);
      evidence('AC-46', { status: first.status, cookieAttrsMatch: true, returnedEqual: true, cookieSha256: sha256(pair).slice(0, 12) });
    });

    it('AC-47: the country reaches the origin', async () => {
      const res = await fetch(`${SITE}${ECHO}`);
      const value = await echoOf(res);
      const loc = await traceLoc();
      expect(value.client.country).toBe(loc);
      expect(value.client.addressPresent).toBe(true);
      evidence('AC-47', { status: res.status, traceLoc: loc, originCountry: value.client.country, addressPresent: value.client.addressPresent });
    });

    it('AC-48: no cf-cache-status HIT on /api/*', async () => {
      const seen = new Map<string, number>();
      for (const path of [ECHO, '/api/time']) {
        for (let i = 0; i < 20; i += 1) {
          const res = await fetch(`${SITE}${path}`);
          await res.arrayBuffer();
          const status = hdr(res, 'cf-cache-status') ?? 'absent';
          seen.set(`${path} ${status}`, (seen.get(`${path} ${status}`) ?? 0) + 1);
          expect(status.toUpperCase()).not.toBe('HIT');
        }
      }
      evidence('AC-48', { requests: 40, cfCacheStatus: JSON.stringify([...seen.entries()]) });
    });

    it('AC-49: the tunnel host is blocked', async () => {
      expect(TUNNEL, 'T2F_LIVE_TUNNEL_HOST').toBeTruthy();
      const probes: Array<[string, string]> = [
        ['GET', '/api/time'],
        ['POST', '/api/webhooks/paypro'],
        ['GET', '/connection/websocket'],
      ];
      const statuses: Record<string, number> = {};
      for (const [method, path] of probes) {
        const res = await fetch(`${TUNNEL}${path}`, { method, redirect: 'manual', body: method === 'POST' ? '{}' : undefined });
        await res.arrayBuffer();
        statuses[`${method} ${path}`] = res.status;
        expect(res.status).toBe(403);
      }
      evidence('AC-49', statuses);
    });

    it('AC-50: forged x-t2f-* and X-Forwarded-For do not reach the origin', async () => {
      const res = await fetch(`${SITE}${ECHO}`, {
        headers: {
          'x-t2f-client': '203.0.113.9;US',
          'x-t2f-edge': randomBytes(16).toString('hex'),
          'x-forwarded-for': '203.0.113.9',
        },
      });
      const value = await echoOf(res);
      const loc = await traceLoc();
      expect(value.edgeVerified).toBe(true);
      expect(value.client.country).toBe(loc);
      evidence('AC-50', { status: res.status, edgeVerified: value.edgeVerified, country: value.client.country, traceLoc: loc });
    });

    it('NFR-1 warm-up: 200 echo GETs are all 200', async () => {
      let ok = 0;
      for (let batch = 0; batch < 20; batch += 1) {
        const results = await Promise.all(
          Array.from({ length: 10 }, async () => {
            const res = await fetch(`${SITE}${ECHO}`);
            await res.arrayBuffer();
            return res.status;
          }),
        );
        for (const status of results) {
          expect(status).toBe(200);
          ok += 1;
        }
      }
      evidence('NFR-1', { requests: ok, note: 'read the Worker CPU p95 in the dashboard' });
    });
  });

  describe.skipIf(MODE !== 'server-down')('mode server-down', () => {
    it('AC-2: static pages are served with the origin stopped', async () => {
      const statuses: Record<string, number> = {};
      for (const path of ['/', countryPath()]) {
        const res = await fetch(`${SITE}${path}`);
        await res.arrayBuffer();
        statuses[path] = res.status;
        expect(res.status).toBe(200);
      }
      evidence('AC-2', statuses);
    });
  });

  describe.skipIf(MODE !== 'tunnel-down')('mode tunnel-down', () => {
    it('AC-9: /api/* answers the edge JSON 503 unavailable', async () => {
      const out: Record<string, string | number | null> = {};
      for (const path of ['/api/time', ECHO]) {
        const res = await fetch(`${SITE}${path}`);
        const text = await res.text();
        expect(res.status).toBe(503);
        expect(text).toBe(UNAVAILABLE_BODY);
        expect(hdr(res, 'retry-after')).toBe('5');
        out[`${path} status`] = res.status;
        out[`${path} retry-after`] = hdr(res, 'retry-after');
        out[`${path} bodySha256`] = sha256(text).slice(0, 12);
      }
      evidence('AC-9', out);
    });
  });

  describe.skipIf(MODE !== 'under-attack')('mode under-attack', () => {
    it('AC-51: the exempt POST passes byte-identical, a page GET is challenged', async () => {
      const key = randomBytes(32);
      const body = new TextEncoder().encode('a=1&b=%C3%A9');
      const signature = createHmac('sha256', key).update(body).digest('hex');
      const res = await fetch(`${SITE}${ECHO}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-t2f-probe-signature': signature },
        body,
      });
      expect(res.status).toBe(200);
      const value = await echoOf(res);
      expect(value.bodySha256).toBe(sha256(body));
      expect(value.headers['x-t2f-probe-signature']).toBe(signature);
      const page = await fetch(`${SITE}/`, { redirect: 'manual' });
      await page.arrayBuffer();
      expect(page.status).not.toBe(200);
      evidence('AC-51', { postStatus: res.status, bodySha256: value.bodySha256, signatureIdentical: true, pageStatus: page.status, pageCfMitigated: hdr(page, 'cf-mitigated') });
    });
  });
});
