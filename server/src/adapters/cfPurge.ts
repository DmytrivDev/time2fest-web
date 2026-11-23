/**
 * Cloudflare cache purge by Cache-Tag (SPEC-08 AC-33, conductor decision А-2), ring 4: the `purge` side of
 * `SnapshotSink`. ONE request per call: `POST <base>/zones/<zone>/purge_cache` with `{"tags":[<tag>]}` — by default
 * the tag the edge stores the public site answer under (`SITE_CACHE_TAG`, one copy in `packages/contracts`).
 * Success = a 2xx answer whose body has `success: true`; anything else throws an error that names the
 * HTTP status only. The token travels only in the `Authorization` header and is never logged or thrown.
 */
import { SITE_CACHE_TAG } from '@time2fest/contracts';
import type { SnapshotSink } from '../site/ports';

export { SITE_CACHE_TAG };
export const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 10_000;

export interface CfPurgeOptions {
  zoneId: string;
  token: string;
  /** Tests point it at a fake on port 0. */
  baseUrl?: string;
  timeoutMs?: number;
  /** The Cache-Tag to purge; `SITE_CACHE_TAG` by default (the live chains purge `LIVE_CACHE_TAG`, SPEC-12 AC-14). */
  tag?: string;
}

export class PurgeFailed extends Error {
  constructor(readonly status: number | 'network') {
    super(`purge failed: ${status}`);
    this.name = 'PurgeFailed';
  }
}

export function createCfPurge(opts: CfPurgeOptions): Pick<SnapshotSink, 'purge'> {
  const url = `${(opts.baseUrl ?? CF_API_BASE).replace(/\/$/, '')}/zones/${encodeURIComponent(opts.zoneId)}/purge_cache`;
  const tag = opts.tag ?? SITE_CACHE_TAG;
  return {
    async purge() {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ tags: [tag] }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        });
      } catch {
        throw new PurgeFailed('network');
      }
      const body = (await res.json().catch(() => null)) as { success?: unknown } | null;
      if (!res.ok || body?.success !== true) throw new PurgeFailed(res.status);
    },
  };
}
