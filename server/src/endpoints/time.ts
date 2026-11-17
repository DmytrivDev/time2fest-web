/**
 * `GET /api/time` (AC-40): the bare `{ now }` of the clock with exactly the headers of
 * `functions/api/time.ts` — no `ApiResult` envelope, no database, no fast store.
 */
import type { RouteRow } from './types';

const TIME_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Robots-Tag': 'noindex',
});

export const timeRoute: RouteRow = {
  key: 'time',
  method: 'GET',
  path: '/api/time',
  async handler(ctx) {
    const now = Math.max(0, Math.round(ctx.clock.now()));
    return new Response(JSON.stringify({ now }), { status: 200, headers: { ...TIME_HEADERS } });
  },
};
