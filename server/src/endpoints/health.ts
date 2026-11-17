/**
 * `GET /api/health` (SPEC-13a AC-5, AC-6): an operational probe for the deploy and the edge, outside
 * the web contracts. Behind the edge gate like every `/api/*` path. 200 `{"ok":true,"commit":…}` when
 * the database and the fast store answer within 2 s, else 503 `{"ok":false}` — no host names, no
 * error text. Raw `Response`, no envelope, no `needs`, no rate limit. Reaches the port through `ctx.deps`.
 */
import { readinessOf } from './deps';
import type { RouteRow } from './types';

const READY_TIMEOUT_MS = 2_000;
const NO_COMMIT = '0'.repeat(40);

const HEALTH_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json; charset=utf-8',
});

export const healthRoute: RouteRow = {
  key: 'health',
  method: 'GET',
  path: '/api/health',
  async handler(ctx) {
    const ready = await readinessOf(ctx.deps).check(READY_TIMEOUT_MS);
    if (!ready) return new Response(JSON.stringify({ ok: false }), { status: 503, headers: { ...HEALTH_HEADERS } });
    const commit = ctx.env.vars.T2F_COMMIT;
    const body = { ok: true, commit: typeof commit === 'string' && commit !== '' ? commit : NO_COMMIT };
    return new Response(JSON.stringify(body), { status: 200, headers: { ...HEALTH_HEADERS } });
  },
};
