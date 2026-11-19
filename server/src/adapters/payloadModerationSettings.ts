/**
 * Payload adapter of the global `moderation-settings` (SPEC-09 AC-42), ring 4. Reads as a server-side
 * call (`overrideAccess`: the global's own `update` access is `never`, only this adapter writes).
 * `write` updates the global with `version + 1` and appends one journal row `moderation.settings`
 * (old and new values) in the same transaction. Absent fields fall back to the domain defaults.
 */
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import type { Actor, Journal, Tx } from '../audit/ports';
import { DEFAULT_SETTINGS, type ModerationSettings } from '../domain/moderation/settings';
import { isDependencyFailure } from '../endpoints/pipeline';
import type { SettingsSource } from '../moderation/spend';
import type { Clock } from '../ports';
import { DependencyUnavailable } from '../ports';

export const MODERATION_SETTINGS = 'moderation-settings';
export const SETTINGS_ACTION = 'moderation.settings';
const CONTEXT = { t2fTrusted: true, t2fInternal: true };

export type SettingsValues = Omit<ModerationSettings, 'version'>;

export interface ModerationSettingsStore extends SettingsSource {
  /**
   * Writes `next` (version + 1) and one journal row with the old and new values, in `tx` or in a
   * transaction of its own. Validation is the caller's (`validateSettings`).
   */
  write(tx: Tx | null, next: SettingsValues, actor: Actor): Promise<ModerationSettings>;
}

const numOr = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
};

function toSettings(doc: Record<string, unknown>): ModerationSettings {
  return {
    reviewThreshold: numOr(doc.reviewThreshold, DEFAULT_SETTINGS.reviewThreshold),
    blockThreshold: numOr(doc.blockThreshold, DEFAULT_SETTINGS.blockThreshold),
    nightCeilingUsd: numOr(doc.nightCeilingUsd, DEFAULT_SETTINGS.nightCeilingUsd),
    monthCeilingUsd: numOr(doc.monthCeilingUsd, DEFAULT_SETTINGS.monthCeilingUsd),
    version: numOr(doc.version, DEFAULT_SETTINGS.version),
  };
}

const values = (s: ModerationSettings): Record<string, unknown> => ({
  reviewThreshold: s.reviewThreshold,
  blockThreshold: s.blockThreshold,
  nightCeilingUsd: s.nightCeilingUsd,
  monthCeilingUsd: s.monthCeilingUsd,
});

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
    throw err;
  }
}

function inner(req: PayloadRequest): PayloadRequest {
  return { ...req, context: { ...req.context, ...CONTEXT } } as PayloadRequest;
}

export function createPayloadModerationSettings(opts: { payload: () => Promise<Payload>; journal: Journal; clock: Clock }): ModerationSettingsStore {
  const readOn = async (req: PayloadRequest) =>
    toSettings((await req.payload.findGlobal({ slug: MODERATION_SETTINGS, req, depth: 0, overrideAccess: true })) as unknown as Record<string, unknown>);

  return {
    read: () =>
      guard(async () => {
        const payload = await opts.payload();
        const doc = await payload.findGlobal({ slug: MODERATION_SETTINGS, depth: 0, overrideAccess: true, context: CONTEXT });
        return toSettings(doc as unknown as Record<string, unknown>);
      }),
    write: (tx, next, actor) =>
      guard(async () => {
        const req = tx ? (tx as PayloadRequest) : await createLocalReq({ context: CONTEXT }, await opts.payload());
        const started = await initTransaction(req);
        try {
          const own = inner(req);
          const before = await readOn(own);
          const stored: ModerationSettings = { ...next, version: before.version + 1 };
          await own.payload.updateGlobal({ slug: MODERATION_SETTINGS, data: stored as never, req: own, depth: 0, overrideAccess: true });
          await opts.journal.append(own, {
            actor,
            action: SETTINGS_ACTION,
            target: { collection: MODERATION_SETTINGS, id: MODERATION_SETTINGS },
            at: opts.clock.now(),
            before: values(before),
            after: values(stored),
            revertOf: null,
          });
          if (started) await commitTransaction(req);
          return stored;
        } catch (err) {
          if (started) await killTransaction(req);
          throw err;
        }
      }),
  };
}
