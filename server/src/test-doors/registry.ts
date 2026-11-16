/**
 * Test-door registry (AC-32, AC-35 … AC-38, AC-62): sorted, unique rows under `/api/_test/*`.
 * Evaluated only in the `test` class with `T2F_TEST_DOORS=1` (see `shouldLoadDoors`).
 * `reset` and `fixtures` are added by SPEC-02 W18.
 */
import { TestClockSetSchema, type TestClockSet } from '@time2fest/contracts/schemas';
import type { ZodType } from 'zod';
import type { TestClock } from '../clock';
import type { Ctx, HttpMethod, Outcome } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

/** What a door may use beyond the request context. */
export interface DoorTools {
  clock: TestClock;
}

export interface DoorRow {
  key: string;
  method: HttpMethod;
  path: string;
  body?: ZodType;
  /** Breaks a shared dependency: runs only while this worktree holds the exclusive lock (AC-33). */
  dependencyBreaking?: true;
  handler(ctx: Ctx, tools: DoorTools): Promise<Outcome>;
}

/** Doors whose fake does not exist yet (AC-32). */
function stub(key: string, path: string): DoorRow {
  return {
    key,
    method: 'POST',
    path,
    async handler() {
      return new Response(JSON.stringify({ ok: false, error: { code: 'unavailable' } }), {
        status: 501,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    },
  };
}

export const doorRegistry: readonly DoorRow[] = [
  {
    key: 'clock-get',
    method: 'GET',
    path: '/api/_test/clock',
    async handler(_ctx, { clock }) {
      return { ok: true, value: clock.state() };
    },
  },
  {
    key: 'clock-set',
    method: 'POST',
    path: '/api/_test/clock',
    body: TestClockSetSchema,
    async handler(ctx, { clock }) {
      clock.set(ctx.body as TestClockSet);
      return { ok: true, value: clock.state() };
    },
  },
  stub('last-code', '/api/_test/last-code'),
  stub('moderation', '/api/_test/moderation'),
  stub('paypro-webhook', '/api/_test/paypro-webhook'),
  stub('video-status', '/api/_test/video-status'),
];

assertRegistry('test-doors', doorRegistry, (d) => d.key);
