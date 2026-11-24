/**
 * Test-door registry (AC-32, AC-35 … AC-38, AC-62; SPEC-07 AC-67, AC-68): sorted, unique rows under
 * `/api/_test/*` — 20 rows (SPEC-12 W38: the `video-status` stub became the `live` door; SPEC-13b W18: + `ops-tick`). Evaluated only in the `test` class with `T2F_TEST_DOORS=1` (see
 * `shouldLoadDoors`). `reset` empties this worktree's data (run records and scheduler runs included)
 * and seeds it (AC-47); `fixtures` applies one named fixture row of the seed registry.
 */
import {
  TestClockSetSchema,
  TestFixturesBodySchema,
  type TestClockSet,
  type TestFixturesBody,
} from '@time2fest/contracts/schemas';
import type { ZodType } from 'zod';
import type { TestClock } from '../clock';
import { failure } from '../endpoints/pipeline';
import { accessTokenDoor } from './accessToken';
import { adminTestSliceDoor } from './adminTestSlice';
import { alarmDoor } from './alarm';
import type { Ctx, HttpMethod, Outcome } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';
import type { SeedStore } from '../ports';
import { collectionRegistry } from '../registries/collections';
import { clearRunFault } from '../scheduler/recorder';
import { resetWorktree, runSeed, type ResettableCollection } from '../seed/index';
import { seedRegistry, type SeedRow } from '../seed/registry';
import { edgeEchoDoors } from './edgeEcho';
import { liveDoor } from './live';
import { moderationDoor } from './moderation';
import { opsTickDoor } from './ops';
import { realtimeTokenDoor, type TestSubjects } from './realtimeToken';
import { schedulerDoors } from './scheduler';
import { siteDoor } from './site';

/** What a door may use beyond the request context. */
export interface DoorTools {
  clock: TestClock;
  /** The seed's row store; doors never see Payload itself. */
  seed: SeedStore;
  /** The current realtime test subject of this doors construction (AC-57). */
  subjects: TestSubjects;
}

export interface DoorRow {
  key: string;
  method: HttpMethod;
  path: string;
  body?: ZodType;
  /** Breaks a shared dependency: runs only while this worktree holds the exclusive lock (AC-33). */
  dependencyBreaking?: true;
  /** The edge probe door only (SPEC-05 W16): copied to the route row, see `RouteRow.edgeProbe`. */
  edgeProbe?: true;
  handler(ctx: Ctx, tools: DoorTools): Promise<Outcome>;
}

/** Doors whose fake does not exist yet (AC-32); `moderation` is real since SPEC-09, `video-status` became `live` in SPEC-12. */
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

/**
 * `POST /api/_test/reset`: own rows and prefixed keys emptied, clock real, seed applied (AC-47, AC-39).
 * SPEC-07: `run-records` and `scheduler-runs` are resettable collections; an armed scheduler fault is
 * dropped, a paused scheduler resumes and reloads its moments from the new seed.
 */
export function resetDoor(
  rows: readonly SeedRow[] = seedRegistry,
  collections: readonly ResettableCollection[] = collectionRegistry,
): DoorRow {
  return {
    key: 'reset',
    method: 'POST',
    path: '/api/_test/reset',
    async handler(ctx, { clock, seed, subjects }) {
      await resetWorktree({
        store: seed,
        fast: ctx.deps.redis,
        redisPrefix: ctx.env.vars.T2F_REDIS_PREFIX,
        clock,
        collections,
        rows: rows.filter((r) => !r.fixture),
      });
      subjects.clear();
      clearRunFault();
      ctx.deps.scheduler?.resume();
      ctx.deps.scheduler?.recompute();
      return { ok: true, value: {} };
    },
  };
}

/** `POST /api/_test/fixtures`: applies the fixture row of that name; an unknown name is `not_found`. */
export function fixturesDoor(rows: readonly SeedRow[] = seedRegistry): DoorRow {
  return {
    key: 'fixtures',
    method: 'POST',
    path: '/api/_test/fixtures',
    body: TestFixturesBodySchema,
    async handler(ctx, { seed }) {
      const { name } = ctx.body as TestFixturesBody;
      const row = rows.find((r) => r.fixture && r.key === name);
      if (!row) return failure('not_found');
      await runSeed(seed, [row]);
      return { ok: true, value: {} };
    },
  };
}

export const doorRegistry: readonly DoorRow[] = [
  accessTokenDoor,
  adminTestSliceDoor,
  alarmDoor,
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
      await clock.set(ctx.body as TestClockSet);
      return { ok: true, value: clock.state() };
    },
  },
  ...edgeEchoDoors,
  fixturesDoor(),
  stub('last-code', '/api/_test/last-code'),
  liveDoor,
  moderationDoor,
  opsTickDoor,
  stub('paypro-webhook', '/api/_test/paypro-webhook'),
  realtimeTokenDoor,
  resetDoor(),
  ...schedulerDoors,
  siteDoor,
];

assertRegistry('test-doors', doorRegistry, (d) => d.key);
