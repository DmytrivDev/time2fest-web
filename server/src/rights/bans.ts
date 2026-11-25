/**
 * Bans (SPEC-11 W16; FR-ID-16, FR-ID-17; AC-18, AC-20 … AC-23, NFR-7). Application ring: SQL through `RightsDb`, the
 * fingerprint marks through `BanMarks` (Redis), the alarm port and the server clock injected.
 * - `ban` — idempotent by `(kind, subject)`; an account ban also bans every device the account has a session row on,
 *   in the same transaction (derived rows, `source_ban_id`), and marks the subject's fingerprint of the day (AC-23).
 * - `unban` — deletes the ban with its derived device bans and clears the subject's fingerprint mark.
 * - `onAccountSession` — a later session of a banned account bans its device too (AC-20).
 * - `isBlocked` — the interface for SPEC-15/16/17: DB bans of the subject and of `ctx.device`, then the daily
 *   fingerprint block for a guest created on a marked fingerprint (AC-24). A Redis failure → the DB answer only and a
 *   `log` alarm `bans/fast-store-down` (NFR-7). No IP or fingerprint is ever written to the database (AC-26).
 */
import { blockedVerdict, nextUtcMidnight, type Blocked } from '../domain/rights/blocked';
import type { Alarm } from '../ports';
import type { BanMarks } from './banMarks';
import type { RightsDb, RightsQuery } from './ports';

export type { Blocked } from '../domain/rights/blocked';
export type BanKind = 'account' | 'guest' | 'device';

export interface BanRecord {
  id: string;
  kind: BanKind;
  subjectId: string;
  /** The account ban a derived device ban comes from. */
  sourceBanId: string | null;
  createdAt: number;
  createdBy: string;
  reasonCode: string | null;
}

export interface BlockedCtx {
  /** The request's device id, if known. */
  device?: string | null;
  /** The subject's kind; the fingerprint block applies only to guests. */
  subjectKind?: 'account' | 'guest';
}

export interface BanService {
  ban(input: { kind: BanKind; subject: string; by: string; reasonCode?: string | null }): Promise<{ ban: BanRecord; created: boolean }>;
  unban(banId: string): Promise<{ removed: boolean; ban: BanRecord | null }>;
  list(): Promise<BanRecord[]>;
  /** The DB part only: the subject or the device is banned (no Redis). */
  bannedInDb(subject: string, device?: string | null): Promise<Blocked>;
  isBlocked(subject: string, ctx?: BlockedCtx): Promise<Blocked>;
  /** `session.create.after` of a non-guest session: a banned account bans the new session's device. Never throws on "not banned". */
  onAccountSession(accountId: string, deviceId: string | null | undefined): Promise<void>;
  /** The middleware's mark step: remembers the subject's fingerprint; a banned subject marks it (AC-23). */
  markRequest(subject: string, fp: string, device: string | null | undefined): Promise<void>;
  /** A guest just created on `fp` (its creation fingerprint, AC-24). */
  guestCreated(guestId: string, fp: string): Promise<void>;
}

export interface BanServiceDeps {
  db(): Promise<RightsDb>;
  marks: BanMarks;
  alarm: Alarm;
  now(): number;
}

interface Row extends Record<string, unknown> {
  id: string;
  kind: BanKind;
  subject_id: string;
  source_ban_id: string | null;
  created_at: Date;
  created_by: string;
  reason_code: string | null;
}

const COLUMNS = 'id::text AS id, kind, subject_id, source_ban_id::text AS source_ban_id, created_at, created_by, reason_code';
const LIST_LIMIT = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRecord(r: Row): BanRecord {
  return {
    id: r.id,
    kind: r.kind,
    subjectId: r.subject_id,
    sourceBanId: r.source_ban_id,
    createdAt: new Date(r.created_at).getTime(),
    createdBy: r.created_by,
    reasonCode: r.reason_code,
  };
}

async function deriveDevices(db: RightsQuery, accountBan: BanRecord, devices: readonly string[], at: number): Promise<void> {
  if (devices.length === 0) return;
  await db.query(
    `INSERT INTO bans (kind, subject_id, source_ban_id, created_at, created_by, reason_code)
     SELECT 'device', d, $1::uuid, $2, $3, $4 FROM unnest($5::text[]) AS d
     ON CONFLICT (kind, subject_id) DO NOTHING`,
    [accountBan.id, new Date(at), accountBan.createdBy, accountBan.reasonCode, devices],
  );
}

export function createBanService(deps: BanServiceDeps): BanService {
  const fastDown = (): void =>
    deps.alarm.raise({ level: 'log', source: 'bans', code: 'bans/fast-store-down' });

  async function bannedInDb(subject: string, device?: string | null): Promise<Blocked> {
    const db = await deps.db();
    const res = await db.query<{ kind: BanKind }>(
      `SELECT kind FROM bans
       WHERE (kind IN ('account', 'guest') AND subject_id = $1) OR (kind = 'device' AND subject_id = $2)`,
      [subject, device ?? null],
    );
    const own = res.rows.find((r) => r.kind !== 'device')?.kind ?? null;
    return blockedVerdict({
      subjectKind: own === 'account' ? 'account' : 'guest',
      subjectBan: own === 'account' || own === 'guest' ? own : null,
      deviceBan: res.rows.some((r) => r.kind === 'device'),
      ipDayMarkAtMs: null,
      guestCreatedAtMs: null,
      nextUtcMidnightMs: nextUtcMidnight(deps.now()),
    });
  }

  async function markSubject(subject: string, at: number): Promise<void> {
    try {
      const fp = await deps.marks.subjectFp(subject, at);
      if (fp !== null) await deps.marks.markFp(fp, at, at);
    } catch {
      fastDown();
    }
  }

  return {
    bannedInDb,

    async ban({ kind, subject, by, reasonCode = null }) {
      const at = deps.now();
      const db = await deps.db();
      const out = await db.tx(async (q) => {
        const inserted = await q.query<Row>(
          `INSERT INTO bans (kind, subject_id, created_at, created_by, reason_code) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (kind, subject_id) DO NOTHING RETURNING ${COLUMNS}`,
          [kind, subject, new Date(at), by, reasonCode],
        );
        const row = inserted.rows[0] ?? (await q.query<Row>(`SELECT ${COLUMNS} FROM bans WHERE kind = $1 AND subject_id = $2`, [kind, subject])).rows[0];
        if (row === undefined) throw new Error('bans: ban row missing');
        const ban = toRecord(row);
        if (kind === 'account' && UUID.test(subject)) {
          const devices = await q.query<{ device_id: string }>(
            'SELECT DISTINCT device_id FROM user_sessions WHERE user_id = $1::uuid AND device_id IS NOT NULL',
            [subject],
          );
          await deriveDevices(q, ban, devices.rows.map((r) => r.device_id), at);
        }
        return { ban, created: inserted.rows.length > 0 };
      });
      if (kind !== 'device') await markSubject(subject, at);
      return out;
    },

    async unban(banId) {
      const db = await deps.db();
      const removed = await db.query<Row>(`DELETE FROM bans WHERE id = $1::uuid OR source_ban_id = $1::uuid RETURNING ${COLUMNS}`, [banId]);
      const main = removed.rows.find((r) => r.id === banId);
      if (main !== undefined && main.kind !== 'device') {
        try {
          const fp = await deps.marks.subjectFp(main.subject_id, deps.now());
          if (fp !== null) await deps.marks.clearFp(fp);
        } catch {
          fastDown();
        }
      }
      return { removed: main !== undefined, ban: main === undefined ? null : toRecord(main) };
    },

    async list() {
      const db = await deps.db();
      const res = await db.query<Row>(`SELECT ${COLUMNS} FROM bans ORDER BY created_at DESC, id LIMIT ${LIST_LIMIT}`);
      return res.rows.map(toRecord);
    },

    async isBlocked(subject, ctx = {}) {
      const fromDb = await bannedInDb(subject, ctx.device);
      if (fromDb.blocked || ctx.subjectKind === 'account') return fromDb;
      const now = deps.now();
      try {
        const created = await deps.marks.guestFp(subject, now);
        if (created === null) return fromDb;
        const mark = await deps.marks.ipDayMark(created.fp, now);
        return blockedVerdict({
          subjectKind: 'guest',
          subjectBan: null,
          deviceBan: false,
          ipDayMarkAtMs: mark,
          guestCreatedAtMs: created.at,
          nextUtcMidnightMs: nextUtcMidnight(now),
        });
      } catch {
        fastDown();
        return fromDb;
      }
    },

    async onAccountSession(accountId, deviceId) {
      if (deviceId === null || deviceId === undefined || deviceId === '') return;
      const db = await deps.db();
      const res = await db.query<Row>(`SELECT ${COLUMNS} FROM bans WHERE kind = 'account' AND subject_id = $1`, [accountId]);
      const row = res.rows[0];
      if (row === undefined) return;
      await deriveDevices(db, toRecord(row), [deviceId], deps.now());
    },

    async markRequest(subject, fp, device) {
      const now = deps.now();
      try {
        // One Redis round trip per request; the ban is read only on the first sighting of the pair today.
        if (!(await deps.marks.rememberSubjectFp(subject, fp, now))) return;
      } catch {
        fastDown();
        return;
      }
      const verdict = await bannedInDb(subject, device);
      if (!verdict.blocked) return;
      try {
        await deps.marks.markFp(fp, now, now);
      } catch {
        fastDown();
      }
    },

    async guestCreated(guestId, fp) {
      try {
        await deps.marks.rememberGuestFp(guestId, fp, deps.now());
      } catch {
        fastDown();
      }
    },
  };
}
