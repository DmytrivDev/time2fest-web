/**
 * Echo door `GET|POST /api/_test/edge-echo` (SPEC-05 AC-34, AC-35, "echo door" contract): shows
 * what reached the origin through the edge, and proves the cookie attributes survive it (AC-46).
 * A test door like the others: it exists only in the `test` class with doors on (AC-36).
 * - Never echoed: `x-t2f-edge`, `x-t2f-client`, the address, the fingerprint, the salt, the raw
 *   `Cookie` header. The header list is an allow-list, and the client part carries only the country
 *   and `addressPresent`. Of the cookies, only the probe cookie's value and the NAMES of the others
 *   are echoed, so the door never reflects an HttpOnly cookie value back to a page script.
 * - Any body type up to 16 KiB; a larger one is the dispatcher's usual `invalid-input` refusal.
 * - `edgeProbe` lets an edge-verified call through `10-origin` with a non-loopback `Host` and a
 *   non-JSON body; no other door has it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_MAX_BODY_BYTES, failure, readBodyBytes } from '../endpoints/pipeline';
import type { Ctx, HttpMethod, Outcome } from '../endpoints/types';
import type { DoorRow } from './registry';

const PATH = '/api/_test/edge-echo';
const PROBE_COOKIE = 't2f_edge_probe';
/** The only request headers the door echoes, in this order (contract; never `x-t2f-edge` / `x-t2f-client`). */
const ECHOED_HEADERS = ['content-type', 'content-length', 'user-agent', 'x-t2f-probe-signature'] as const;

/** The probe cookie's value and the names of the other cookies; no other cookie value leaves here. */
function cookiesOf(req: Request): { probeCookie: string | null; cookieNames: string[] } {
  let probeCookie: string | null = null;
  const cookieNames: string[] = [];
  const header = req.headers.get('cookie');
  if (header === null) return { probeCookie, cookieNames };
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    const name = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (name === '') continue;
    if (name === PROBE_COOKIE && eq !== -1) probeCookie = part.slice(eq + 1).trim();
    else cookieNames.push(name);
  }
  return { probeCookie, cookieNames };
}

async function echo(ctx: Ctx): Promise<Outcome> {
  const { req, url, client } = ctx;
  const bytes = await readBodyBytes(req, DEFAULT_MAX_BODY_BYTES);
  if (bytes === undefined) return failure('validation', { reason: 'invalid-input' });

  const headers: Record<string, string> = {};
  for (const name of ECHOED_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const { probeCookie, cookieNames } = cookiesOf(req);
  const value = {
    method: req.method,
    path: url.pathname,
    query: url.search.slice(1), // `search` is '' or starts with '?'
    bodyBytes: bytes.byteLength,
    bodySha256: createHash('sha256').update(bytes).digest('hex'),
    headers,
    edgeVerified: client.edgeVerified,
    client: { country: client.country, addressPresent: client.addressPresent },
    probeCookie,
    cookieNames,
  };

  const out = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' });
  if (probeCookie === null) {
    out.append('set-cookie', `${PROBE_COOKIE}=${randomBytes(16).toString('hex')}; Path=/; Secure; HttpOnly; SameSite=Lax`);
  }
  return new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: out });
}

function echoDoor(key: string, method: HttpMethod): DoorRow {
  return { key, method, path: PATH, edgeProbe: true, handler: (ctx) => echo(ctx) };
}

/** Both rows, in key order, for the door registry. */
export const edgeEchoDoors: readonly DoorRow[] = [echoDoor('edge-echo-get', 'GET'), echoDoor('edge-echo-post', 'POST')];
