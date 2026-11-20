import { beforeAll, expect, it } from 'vitest';
import { createHttpSite, type SiteFetch } from '@/lib/api/http/site';
import { describeDomain } from './site.suite';

const BASE = process.env.T2F_SERVER_URL ?? '';
const ORIGIN = process.env.T2F_HTTP_ORIGIN ?? 'http://localhost:3000';

async function door(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
}

beforeAll(async () => {
  await door('/api/_test/reset', {});
  await door('/api/_test/site', { action: 'reset' });
}, 60_000);

/** The adapter itself, with the server's absolute address; no realtime (the suite reads, it does not wait for events). */
const serverFetch: SiteFetch = (input, init) => fetch(`${BASE}${input}`, init);
const makeService = () => createHttpSite({ fetch: serverFetch, loadTransport: null, prelaunch: false });

describeDomain('site (http)', makeService);

it('a switch changed through the door is read with a higher version, then the reset restores it', async () => {
  const svc = makeService();
  const before = await svc.state();
  if (!before.ok) throw new Error(`state() → ${before.error.code}`);
  await door('/api/_test/site', { action: 'switch', key: 'chat', value: false, mode: 'manual', reason: 'contract suite' });
  const after = await makeService().state();
  if (!after.ok) throw new Error(`state() → ${after.error.code}`);
  expect(after.value.switches.chat).toBe(false);
  expect(after.value.version).toBeGreaterThan(before.value.version);
  await door('/api/_test/site', { action: 'reset' });
});
