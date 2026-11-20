// Red button at the edge (SPEC-08 AC-38 … AC-41, NFR-4): an R2 object that, while present and valid,
// is served at the public `site` address instead of the origin or the cache.
// Read at most once per 10 s per isolate; the memo keeps "absent" too, and concurrent requests share one read.
import { parseSiteState, type SiteStateLike } from '../../../packages/contracts/src/siteGuard';
import { siteBucketOf, type EdgeDeps, type EdgeEnv } from './env';

/** One bucket read per isolate per this window (NFR-4). */
export const RED_BUTTON_MEMO_MS = 10_000;

type Memo = { at: number; state: Promise<SiteStateLike | null> };
let memo: Memo | undefined;

/** Forgets the isolate memo (tests only: every test is a "fresh isolate"). */
export function resetRedButtonMemo(): void {
  memo = undefined;
}

function log(event: 'site/red-button-read-failed' | 'site/red-button-invalid'): void {
  console.warn(JSON.stringify({ event }));
}

/** The valid red-button snapshot (with `outage: 'technical'`), or null when absent, unreadable or invalid. */
export function redButtonState(
  env: Pick<EdgeEnv, 'SITE_BUCKET' | 'R2_PREFIX'>,
  key: string,
  deps: Pick<EdgeDeps, 'now'>,
): Promise<SiteStateLike | null> {
  const site = siteBucketOf(env); // no bucket, or a missing/malformed prefix → never read (fail closed)
  if (!site) return Promise.resolve(null);
  const now = deps.now();
  if (memo && now >= memo.at && now - memo.at < RED_BUTTON_MEMO_MS) return memo.state;
  const state = read(site.bucket, `${site.prefix}${key}`);
  memo = { at: now, state };
  return state;
}

async function read(bucket: NonNullable<EdgeEnv['SITE_BUCKET']>, key: string): Promise<SiteStateLike | null> {
  let text: string;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    text = await obj.text();
  } catch {
    log('site/red-button-read-failed');
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    log('site/red-button-invalid');
    return null;
  }
  const state = parseSiteState(body);
  if (!state || state.outage !== 'technical') {
    log('site/red-button-invalid');
    return null;
  }
  return state;
}
