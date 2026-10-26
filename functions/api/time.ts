// Cloudflare Pages Function: GET /api/time (contracts/time-api.md).
export const onRequestGet = async (): Promise<Response> =>
  new Response(JSON.stringify({ now: Date.now() }), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Robots-Tag': 'noindex',
    },
  });
