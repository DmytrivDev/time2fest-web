/**
 * The R2 copy of the catalog (AC-72, AC-73), ring 3. A subscriber of `catalog.changed`: it reads the
 * catalog the way `GET /api/catalog` does and writes it to the bucket of its environment under
 * `<prefix>catalog/latest.json` and `<prefix>catalog/<version>.json`.
 *
 * It runs after the change is committed and never blocks the delivery loop: the work is detached. A failed
 * write is retried at 0, 30, 120 and 300 s after the event (three retries inside five minutes); after the
 * last failure it raises a `page` alarm. Each attempt reads the catalog afresh, so a retry never writes a
 * version older than the one the database has.
 */
import type { EventSubscriber } from '../events/ports';
import type { Alarm, Logger } from '../ports';
import type { CatalogStore, ObjectStore } from './ports';
import { readCatalog } from './service';

export const COPY_SUBSCRIBER_KEY = 'catalog-r2-copy';
export const COPY_FAILED_CODE = 'catalog-r2-copy-failed';
/** Offsets from the event, in ms: the first write and three retries. */
export const DEFAULT_SCHEDULE: readonly number[] = [0, 30_000, 120_000, 300_000];

export interface CatalogCopyDeps {
  store: CatalogStore;
  objects: ObjectStore;
  /** The environment's key prefix, `<slug>/` (AC-74). */
  prefix: string;
  alarm: Alarm;
  log: Logger;
  /** Offsets of the attempts; tests inject short ones. */
  schedule?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export interface CopyOutcome {
  ok: boolean;
  attempts: number;
  version?: string;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function copyOnce(deps: CatalogCopyDeps): Promise<string> {
  const catalog = await readCatalog(deps.store);
  if (!catalog.ok) throw new Error('catalog-unavailable');
  const body = JSON.stringify(catalog.value);
  await deps.objects.put(`${deps.prefix}catalog/latest.json`, body, 'application/json');
  await deps.objects.put(`${deps.prefix}catalog/${catalog.value.version}.json`, body, 'application/json');
  return catalog.value.version;
}

/** Copies the catalog, retrying on the schedule; the `page` alarm after the last failure. */
export async function copyCatalog(deps: CatalogCopyDeps): Promise<CopyOutcome> {
  const schedule = deps.schedule ?? DEFAULT_SCHEDULE;
  const sleep = deps.sleep ?? realSleep;
  let attempts = 0;
  for (const [index, offset] of schedule.entries()) {
    const wait = offset - (schedule[index - 1] ?? 0);
    if (wait > 0) await sleep(wait);
    attempts += 1;
    try {
      const version = await copyOnce(deps);
      return { ok: true, attempts, version };
    } catch (err) {
      // The error name only: a message from the SDK may carry the endpoint or request details.
      deps.log.warn({ msg: 'catalog r2 copy failed', attempt: attempts, of: schedule.length, err: err instanceof Error ? err.name : 'error' });
    }
  }
  deps.alarm.raise({ level: 'page', source: 'catalog', code: COPY_FAILED_CODE, details: { attempts } });
  return { ok: false, attempts };
}

const inFlight = new Set<Promise<CopyOutcome>>();

/** Resolves when every copy started in this process has finished (tests and a clean shutdown). */
export async function settleCopies(): Promise<CopyOutcome[]> {
  return Promise.all([...inFlight]);
}

/**
 * The subscriber row. `resolve` returns the deps lazily (the composition root is not importable from the
 * registry), or `undefined` when the environment has no object store configured: then nothing is copied.
 */
export function createCatalogR2Subscriber(resolve: () => Promise<CatalogCopyDeps | undefined>): EventSubscriber {
  return {
    key: COPY_SUBSCRIBER_KEY,
    topic: 'catalog.changed',
    handle() {
      const task = resolve()
        .then((deps) => (deps ? copyCatalog(deps) : { ok: true, attempts: 0 }))
        .catch((): CopyOutcome => ({ ok: false, attempts: 0 }));
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    },
  };
}
