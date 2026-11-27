/**
 * Guest → account merge of the passport (SPEC-14 W31, [А13]; AC-44 … AC-47): the `authLinks` row `stamps`, pattern
 * `rights/links.ts`. Run by `linkGuest` (`auth/merge.ts`) once per `(guest, account)` and by the retry job; idempotent for
 * the pair (a second run finds no guest rows) and may throw (→ retry row, `auth/link-retry`, the sign-in completes).
 * In one transaction, guest rows locked first:
 * - stamps: every guest stamp moves to the account; for an event both hold, the EARLIER issued stamp stays (A-3);
 * - proofs: move; a shared proof keeps the earliest first / latest last receipt and the higher-priority source;
 * - achievements: move (a shared key keeps the earlier `achieved_at`), then the current season's keys are recomputed
 *   from the merged stamps (`achievementsOf`) and the missing ones stored;
 * - the old-moment journal moves.
 * After the commit, only when something moved: the `stamp` envelope `snapshot` (all stamps of the current season) to
 * `user:#<account>`, and the internal event `passport.merged` with the keys the account did not hold before the merge,
 * at most one per kind (the highest threshold); no event when there are none. Neither publication throws. No subject id
 * is logged (NFR-5).
 * Application ring (A3): the row takes `PresenceLinkPorts`; `registries/authLinks.ts` maps its deps to them.
 */
import { randomUUID } from 'node:crypto';
import type { PassportStamp, StampEvent } from '@time2fest/contracts';
import { sourcesBelow } from '../domain/presence/source';
import { createAchievementService, createSqlAchievementStore, type AchievementLookups } from './achievements';
import type { RightsDb, RightsQuery } from '../rights/ports';
import type { ProofRow, StampRow } from './ports';

export const STAMPS_LINK_KEY = 'stamps';
export const PASSPORT_MERGED_TOPIC = 'passport.merged';

/** Payload of the internal event "passport merged". */
export interface PassportMergedPayload {
  subject: string;
  season: string | null;
  newKeys: string[];
}

export interface PresenceLinkPorts {
  db(): Promise<RightsDb>;
  /** The server clock (NFR-8). */
  now(): number;
  /** The current season key of the catalog (null without one) and the lookups achievements need. */
  season(now: number): Promise<{ key: string | null; lookups: AchievementLookups }>;
  /** The subject's stamps of the current season, as the passport list shows them. */
  snapshot(subjectId: string, now: number): Promise<PassportStamp[]>;
  channel(): { publish(channelClass: 'user', key: string, envelope: StampEvent): Promise<{ status: string }> } | undefined;
  internal(): { publish(tx: Record<string, never>, topic: string, payload: unknown): Promise<unknown> } | undefined;
  log: { warn(fields: Record<string, unknown>): void };
}

export interface PresenceLinkRow<D> {
  key: string;
  link(input: { fromSubject: string; toSubject: string; deps: D }): Promise<void>;
}

/** Of the new keys, one per kind (`goal:<season>:countries`, `streak:<season>`, …): the highest threshold. Sorted. */
export function mergeReportKeys(keys: readonly string[]): string[] {
  const best = new Map<string, { key: string; level: number }>();
  for (const key of keys) {
    const cut = key.lastIndexOf(':');
    if (cut <= 0) continue;
    const kind = key.slice(0, cut);
    const level = Number(key.slice(cut + 1));
    if (!Number.isFinite(level)) continue;
    const held = best.get(kind);
    if (held === undefined || level > held.level) best.set(kind, { key, level });
  }
  return [...best.values()].map((b) => b.key).sort();
}

/** One transaction's query handle as the `RightsDb` the achievement store takes (nested `tx` stays on it). */
const inTx = (q: RightsQuery): RightsDb => ({ query: (text, values) => q.query(text, values), tx: (fn) => fn(q) });

const STAMP_COLUMNS = 'subject_id, season, event_id, granted_at, presence_source, grant_kind, issued_at';

interface MergeResult {
  moved: boolean;
  newKeys: string[];
}

async function mergeRows(p: PresenceLinkPorts, from: string, to: string, now: number): Promise<MergeResult> {
  const season = await p.season(now);
  const db = await p.db();
  const achievements = createAchievementService({
    store: createSqlAchievementStore(),
    stamps: async (q, subject, s) =>
      (await q.query<StampRow & Record<string, unknown>>(`SELECT ${STAMP_COLUMNS} FROM stamps WHERE subject_id = $1 AND season = $2 ORDER BY granted_at, event_id`, [subject, s])).rows,
  });
  return db.tx(async (q) => {
    const stamps = (await q.query<StampRow & Record<string, unknown>>(`SELECT ${STAMP_COLUMNS} FROM stamps WHERE subject_id = $1 FOR UPDATE`, [from])).rows;
    const proofs = (
      await q.query<ProofRow & Record<string, unknown>>(
        'SELECT subject_id, season, event_id, moment_ms, first_received_at, last_received_at, source FROM presence_proofs WHERE subject_id = $1 FOR UPDATE',
        [from],
      )
    ).rows;
    const guestKeys = (await q.query<{ season: string; key: string; achieved_at: string }>('SELECT season, key, achieved_at FROM passport_achievements WHERE subject_id = $1 FOR UPDATE', [from])).rows;
    const journal = await q.query('UPDATE stamp_old_moment_log SET subject_id = $2 WHERE subject_id = $1', [from, to]);
    const moved = stamps.length > 0 || proofs.length > 0 || guestKeys.length > 0 || (journal.rowCount ?? 0) > 0;
    if (!moved) return { moved: false, newKeys: [] };

    const before = new Set((await q.query<{ key: string }>('SELECT key FROM passport_achievements WHERE subject_id = $1 FOR UPDATE', [to])).rows.map((r) => r.key));

    for (const s of stamps) {
      // The earlier issued stamp of an event stays (A-3); a tie keeps the account's.
      await q.query(
        `INSERT INTO stamps (${STAMP_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (subject_id, season, event_id) DO UPDATE SET granted_at = EXCLUDED.granted_at, presence_source = EXCLUDED.presence_source,
           grant_kind = EXCLUDED.grant_kind, issued_at = EXCLUDED.issued_at
         WHERE EXCLUDED.issued_at < stamps.issued_at`,
        [to, s.season, s.event_id, String(s.granted_at), s.presence_source, s.grant_kind, String(s.issued_at)],
      );
    }
    for (const r of proofs) {
      await q.query(
        `INSERT INTO presence_proofs (subject_id, season, event_id, moment_ms, first_received_at, last_received_at, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (subject_id, season, event_id, moment_ms) DO UPDATE SET
           first_received_at = LEAST(presence_proofs.first_received_at, EXCLUDED.first_received_at),
           last_received_at = GREATEST(presence_proofs.last_received_at, EXCLUDED.last_received_at),
           source = CASE WHEN presence_proofs.source = ANY($8::text[]) THEN EXCLUDED.source ELSE presence_proofs.source END`,
        [to, r.season, r.event_id, String(r.moment_ms), String(r.first_received_at), r.last_received_at === null ? null : String(r.last_received_at), r.source, sourcesBelow(r.source)],
      );
    }
    for (const k of guestKeys) {
      await q.query(
        `INSERT INTO passport_achievements (subject_id, season, key, achieved_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (subject_id, key) DO UPDATE SET achieved_at = LEAST(passport_achievements.achieved_at, EXCLUDED.achieved_at)`,
        [to, k.season, k.key, String(k.achieved_at)],
      );
    }
    await q.query('DELETE FROM stamps WHERE subject_id = $1', [from]);
    await q.query('DELETE FROM presence_proofs WHERE subject_id = $1', [from]);
    await q.query('DELETE FROM passport_achievements WHERE subject_id = $1', [from]);

    // Keys come from the catalog's lookups, valid for the current season only; other seasons keep the moved rows.
    if (season.key !== null) await achievements.grant(inTx(q), { subjectId: to, season: season.key, now, lookups: season.lookups });
    const after = (await q.query<{ key: string }>('SELECT key FROM passport_achievements WHERE subject_id = $1', [to])).rows.map((r) => r.key);
    return { moved: true, newKeys: after.filter((k) => !before.has(k)) };
  });
}

async function publishMerged(p: PresenceLinkPorts, account: string, season: string | null, newKeys: string[], now: number): Promise<void> {
  const warn = (fields: Record<string, unknown>) => {
    try {
      p.log.warn(fields);
    } catch {
      // A logger never throws.
    }
  };
  let result: string;
  try {
    const channel = p.channel();
    if (channel) {
      const envelope: StampEvent = { type: 'stamp', id: randomUUID(), data: { kind: 'snapshot', stamps: await p.snapshot(account, now) } };
      result = (await channel.publish('user', account, envelope)).status;
    } else result = 'not-configured';
  } catch {
    result = 'unavailable';
  }
  if (result !== 'ok') warn({ event: 'stamp-snapshot-publish', result });

  const report = mergeReportKeys(newKeys);
  if (report.length === 0) return;
  const payload: PassportMergedPayload = { subject: account, season, newKeys: report };
  try {
    const internal = p.internal();
    if (internal) await internal.publish({}, PASSPORT_MERGED_TOPIC, payload);
    else warn({ event: 'passport-merged-event', result: 'not-configured' });
  } catch {
    warn({ event: 'passport-merged-event', result: 'unavailable' });
  }
}

async function linkStamps(p: PresenceLinkPorts, fromSubject: string, toSubject: string): Promise<void> {
  if (fromSubject === toSubject) return;
  const now = p.now();
  const r = await mergeRows(p, fromSubject, toSubject, now);
  if (!r.moved) return;
  const season = await p.season(now).then((s) => s.key).catch(() => null);
  await publishMerged(p, toSubject, season, r.newKeys, now);
}

/** The registry row `stamps` over `portsOf(deps)`. */
export function createPresenceLinks<D>(portsOf: (deps: D) => PresenceLinkPorts): PresenceLinkRow<D>[] {
  return [{ key: STAMPS_LINK_KEY, link: ({ fromSubject, toSubject, deps }) => linkStamps(portsOf(deps), fromSubject, toSubject) }];
}
