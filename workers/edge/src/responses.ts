// Responses the edge makes itself. Bodies reuse the existing ApiError codes (`not_found`, `unavailable`).
const JSON_TYPE = 'application/json; charset=utf-8';
const PRIVATE = 'private, no-store';

export const NOT_FOUND_BODY = '{"ok":false,"error":{"code":"not_found"}}';
export const UNAVAILABLE_BODY = '{"ok":false,"error":{"code":"unavailable","retryAfterMs":5000}}';

/** The single 404 for `/api`, WebSocket upgrades and API paths with no origin. */
export function notFound(): Response {
  return new Response(NOT_FOUND_BODY, {
    status: 404,
    headers: { 'content-type': JSON_TYPE, 'cache-control': PRIVATE },
  });
}

/** Origin unreachable, failing, or the edge is misconfigured (fail closed). */
export function unavailable(): Response {
  return new Response(UNAVAILABLE_BODY, {
    status: 503,
    headers: { 'content-type': JSON_TYPE, 'cache-control': PRIVATE, 'retry-after': '5' },
  });
}

/** GET /api/time answered at the edge (same contract as the former Pages Function). */
export function timeNow(now: number): Response {
  return new Response(JSON.stringify({ now: Math.trunc(now) }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': JSON_TYPE,
      'X-Robots-Tag': 'noindex',
    },
  });
}
