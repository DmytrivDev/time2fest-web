/**
 * Next 16 Proxy (Node runtime): the Cloudflare Access gate in front of Payload (AC-1, AC-4, AC-6).
 * Every path except `/api/*` needs a valid `Cf-Access-Jwt-Assertion` header (the header, never the
 * Access cookie); `/admin*` and `/cms-api*` on a foreign host are rewritten to Next's
 * own 404, the same as an unknown path. On a pass the request carries a signed identity marker
 * for the second check inside Payload; an inbound marker is always removed. Any error → 403.
 * Admin static assets are gated too (behind Access that is expected).
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { AccessGate } from './access/gate';
import type { IdentityMarker } from './access/ports';
import { IDENTITY_HEADER } from './adapters/identityMarker';
import { getAccessGate, getIdentityMarker } from './container';

export const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion';

/** A path with no route: Next answers it with its own 404 page. */
export const NOT_FOUND_PATH = '/__t2f-not-found';

const forbidden = () => new Response(null, { status: 403 });

/** The proxy over an explicit gate and marker (tests); `proxy` uses the process ones. */
export function proxyWith(gate: () => Promise<AccessGate>, marker: () => IdentityMarker) {
  return async (req: NextRequest): Promise<Response> => {
    const headers = new Headers(req.headers);
    headers.delete(IDENTITY_HEADER);
    try {
      const result = await (await gate()).check({
        path: req.nextUrl.pathname,
        host: req.headers.get('host') ?? '',
        token: req.headers.get(ACCESS_JWT_HEADER),
      });
      if (result.kind === 'deny403') return forbidden();
      if (result.kind === 'notFound404') return NextResponse.rewrite(new URL(NOT_FOUND_PATH, req.url));
      if (result.identity) headers.set(IDENTITY_HEADER, marker().sign(result.identity));
      return NextResponse.next({ request: { headers } });
    } catch {
      return forbidden();
    }
  };
}

export const proxy = proxyWith(getAccessGate, getIdentityMarker);

/**
 * Everything but the public API. The not-found target is excluded too: Next runs the proxy again
 * on the rewritten path, and no route exists there, so it is always Next's own 404.
 */
export const config = { matcher: ['/((?!api/|__t2f-not-found).*)'] };
