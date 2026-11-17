// Forwards an `/api/*` request to the origin. The body is passed as a stream and never read;
// no cache options are set and the origin response is returned untouched (AC-5…AC-9, NFR-4).
import type { EdgeDeps } from './env';
import { unavailable } from './responses';

const EDGE_HEADER = 'x-t2f-edge';
const CLIENT_HEADER = 'x-t2f-client';
/** Client-sent address headers: never forwarded, so the origin sees only `x-t2f-client` as the address. */
const CLIENT_ADDRESS_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'true-client-ip', 'cf-connecting-ip'] as const;

/** Statuses that, without a JSON body, are Cloudflare or tunnel failures, not the server's own answer. */
function isEdgeFailure(res: Response): boolean {
  const s = res.status;
  if (s !== 502 && s !== 503 && s !== 504 && (s < 520 || s > 530)) return false;
  const type = res.headers.get('content-type') ?? '';
  return !type.toLowerCase().startsWith('application/json');
}

export async function proxy(
  req: Request,
  originUrl: string,
  secret: string,
  deps: Pick<EdgeDeps, 'fetch' | 'cf'>,
): Promise<Response> {
  const url = new URL(req.url);
  const target = new URL(originUrl).origin + url.pathname + url.search;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete(EDGE_HEADER);
  headers.delete(CLIENT_HEADER);
  for (const name of CLIENT_ADDRESS_HEADERS) headers.delete(name);
  headers.set(EDGE_HEADER, secret);
  headers.set(
    CLIENT_HEADER,
    `${req.headers.get('cf-connecting-ip') ?? ''};${deps.cf?.country ?? ''}`,
  );

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  // `duplex` is required by Node's fetch for a stream body and is missing from workers-types.
  const init = {
    method: req.method,
    headers,
    body: hasBody ? req.body : null,
    redirect: 'manual',
    duplex: 'half',
  } as RequestInit;

  let res: Response;
  try {
    res = await deps.fetch(target, init);
  } catch {
    return unavailable();
  }

  if (isEdgeFailure(res)) {
    await res.body?.cancel().catch(() => undefined);
    return unavailable();
  }
  return res;
}
