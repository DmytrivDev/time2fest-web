/**
 * Chaos of the second Mailpit (SPEC-10 [П-10], W21): only `mailpit-chaos` (API 127.0.0.1:8026) is ever changed.
 * Every change runs under the cross-worktree Redis lock `t2f:test:mailpit-chaos` (database 0, no worktree prefix,
 * 60 s) and the triggers are reset to 0 in `finally`.
 */
import { randomUUID } from 'node:crypto';
import { createRedisStore } from '../../src/adapters/redis';
import { MAILPIT_CHAOS_API } from './mailpit';

const LOCK_KEY = 't2f:test:mailpit-chaos';
const LOCK_MS = 60_000;

export interface ChaosTrigger {
  ErrorCode: number;
  Probability: number;
}
export type Chaos = Partial<Record<'Sender' | 'Recipient' | 'Authentication', ChaosTrigger>>;

const ZERO: Required<Chaos> = {
  Sender: { ErrorCode: 451, Probability: 0 },
  Recipient: { ErrorCode: 451, Probability: 0 },
  Authentication: { ErrorCode: 535, Probability: 0 },
};

export async function getChaos(): Promise<Required<Chaos>> {
  const r = await fetch(`${MAILPIT_CHAOS_API}/api/v1/chaos`);
  if (!r.ok) throw new Error(`mailpit-chaos ${r.status}`);
  return (await r.json()) as Required<Chaos>;
}

async function putChaos(c: Chaos): Promise<void> {
  const r = await fetch(`${MAILPIT_CHAOS_API}/api/v1/chaos`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...ZERO, ...c }),
  });
  if (!r.ok) throw new Error(`mailpit-chaos put ${r.status}`);
}

/** Lock store on database 0 so every worktree sees the same key. */
function lockStore() {
  const url = new URL(String(process.env.REDIS_URL));
  url.pathname = '/0';
  return createRedisStore({ REDIS_URL: url.toString(), T2F_REDIS_PREFIX: '' });
}

/** Runs `fn` with the chaos set to `c`, under the lock; triggers back to 0 afterwards. */
export async function withChaos<T>(c: Chaos, fn: () => Promise<T>, waitMs = 60_000): Promise<T> {
  const store = lockStore();
  const owner = randomUUID();
  const until = Date.now() + waitMs;
  try {
    while (!(await store.setIfAbsent(LOCK_KEY, owner, LOCK_MS))) {
      if (Date.now() > until) throw new Error('mailpit-chaos: lock busy');
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      await putChaos(c);
      return await fn();
    } finally {
      await putChaos({});
      if ((await store.get(LOCK_KEY)) === owner) await store.del(LOCK_KEY);
    }
  } finally {
    await store.close();
  }
}
