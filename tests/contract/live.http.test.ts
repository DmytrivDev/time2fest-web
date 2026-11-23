import { beforeAll } from 'vitest';
import { createHttpLive, type LiveFetch } from '@/lib/api/http/live';
import { describeDomain } from './live.suite';

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
  await door('/api/_test/live', { door: 'reset-live' });
}, 60_000);

/** The adapter itself, with the server's absolute address; no realtime (the suite reads, it does not wait for events). */
// Node's fetch sends no `Origin`; a browser's same-origin POST does, so the harness adds the site origin.
const serverFetch: LiveFetch = (input, init) =>
  fetch(`${BASE}${input}`, { ...init, headers: { ...init.headers, origin: ORIGIN } });

describeDomain('live (http)', () => createHttpLive({ fetch: serverFetch, loadTransport: null, prelaunch: false }));
