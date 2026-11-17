import { beforeAll } from 'vitest';
import { describeDomain } from './time.suite';

const BASE = process.env.T2F_SERVER_URL ?? '';
const ORIGIN = process.env.T2F_HTTP_ORIGIN ?? 'http://localhost:3000';

beforeAll(async () => {
  const res = await fetch(`${BASE}/api/_test/reset`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`reset failed: ${res.status}`);
}, 60_000);

describeDomain('time (http)', () => fetch(`${BASE}/api/time`));
