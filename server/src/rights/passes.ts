/**
 * Pass records (SPEC-11 W12, W13; FR-ID-07 … FR-ID-11, FR-ID-14, FR-ID-15). Application ring: SQL through the
 * `RightsDb` port, the season clock and the event port are injected.
 * - `view` — the session's pass fields: ONE query (the account's active pass ∪ the device's active unattached pass,
 *   both by index; NFR-1), mapped by the pure FR-ID-14 view.
 * - `grantPass` — idempotent by `grantRef` (`ON CONFLICT DO NOTHING` + re-read); `pass-owned` for a holder that
 *   already has an active pass for the holiday (account: also guarded by `passes_one_active_per_account`).
 * - `attachOnSignIn` [П-3] — path (a) this device, then path (b) the account's verified email (earliest unattached
 *   first, EC-3); each attempt is one conditional UPDATE in its own short transaction, guarded by the partial
 *   unique index: 1 row → attached; 0 rows → re-read (ours → idempotent, else next); `23505` → the account already
 *   has a pass, the device pass stays where it is. At most one pass per sign-in (AC-7). No advisory lock.
 * - `revokePass`, `passOwnedByEmail`, `hasPass`.
 * "Now" is the server's season clock, never the client. Emails are never logged.
 */
import { firstOpenSeason, passSeason, type SeasonCtx } from '../domain/rights/passSeason';
import { passView, type PassView } from '../domain/rights/passView';
import type { PassEventReason, PassEventTarget } from './events';
import type { RightsDb, RightsQuery } from './ports';

export type PassSource = 'purchase' | 'gift' | 'admin';
export type PassHolder = { account: string } | { device: string; paymentEmail: string };

export interface PassRecord {
  id: string;
  season: string;
  source: PassSource;
  grantRef: string;
  paymentEmail: string | null;
  deviceId: string | null;
  attachedUserId: string | null;
  issuedAt: number;
  attachedAt: number | null;
  revokedAt: number | null;
}

export type GrantResult = { kind: 'granted'; pass: PassRecord; created: boolean } | { kind: 'pass-owned' };
export type RevokeResult = { pass: PassRecord | null; revoked: boolean };
export interface AttachResult {
  attached: string | null;
  from: 'device' | 'email' | null;
  /** Path (b): the device the pass was on (its subjects get `pass-attached`, AC-12). */
  previousDevice?: string | null;
}

export interface PassServiceDeps {
  db(): Promise<RightsDb>;
  now(): number;
  season(): SeasonCtx;
  /** Event port; never throws. */
  publish(db: RightsQuery, targets: readonly PassEventTarget[], reason: PassEventReason): Promise<void>;
}

export interface PassService {
  view(input: { accountId: string | null; device: string }): Promise<PassView>;
  hasPass(subjectId: string, device: string): Promise<boolean>;
  grantPass(input: { holder: PassHolder; source: PassSource; grantRef: string; issuedAt?: number }): Promise<GrantResult>;
  revokePass(grantRef: string): Promise<RevokeResult>;
  /** `account`/`device`; `email` = the account's VERIFIED email (path (b) runs only with it). */
  attachOnSignIn(input: { account: string; device: string | null; email: string | null }): Promise<AttachResult>;
  passOwnedByEmail(email: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = 'revoked_at IS NULL AND erased_at IS NULL';
const UNATTACHED = `attached_user_id IS NULL AND ${ACTIVE}`;
const COLUMNS =
  'id::text AS id, season, source, grant_ref, payment_email, device_id, attached_user_id::text AS attached_user_id, issued_at, attached_at, revoked_at';

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

type Row = {
  id: string;
  season: string;
  source: PassSource;
  grant_ref: string;
  payment_email: string | null;
  device_id: string | null;
  attached_user_id: string | null;
  issued_at: Date | string;
  attached_at: Date | string | null;
  revoked_at: Date | string | null;
};

const msOf = (v: Date | string): number => (v instanceof Date ? v.getTime() : Date.parse(v));
const msOrNull = (v: Date | string | null): number | null => (v === null ? null : msOf(v));

function toRecord(r: Row): PassRecord {
  return {
    id: r.id,
    season: r.season,
    source: r.source,
    grantRef: r.grant_ref,
    paymentEmail: r.payment_email,
    deviceId: r.device_id,
    attachedUserId: r.attached_user_id,
    issuedAt: msOf(r.issued_at),
    attachedAt: msOrNull(r.attached_at),
    revokedAt: msOrNull(r.revoked_at),
  };
}

/** SQLSTATE 23505 on a given unique index. */
function uniqueViolation(e: unknown, constraint: string): boolean {
  const err = e as { code?: unknown; constraint?: unknown } | null;
  return err !== null && typeof err === 'object' && err.code === '23505' && err.constraint === constraint;
}

function holderTargets(p: PassRecord): PassEventTarget[] {
  if (p.attachedUserId !== null) return [{ account: p.attachedUserId }];
  return p.deviceId !== null ? [{ device: p.deviceId }] : [];
}

export function createPassService(deps: PassServiceDeps): PassService {
  /** The earliest holiday still open at `now`: a pass is active iff `season >= open` (keys sort as text). */
  const openSeason = (): string => firstOpenSeason(deps.now(), deps.season());

  async function byGrantRef(db: RightsQuery, grantRef: string): Promise<PassRecord | null> {
    const res = await db.query<Row>(`SELECT ${COLUMNS} FROM passes WHERE grant_ref = $1`, [grantRef]);
    return res.rows[0] ? toRecord(res.rows[0]) : null;
  }

  async function view({ accountId, device }: { accountId: string | null; device: string }): Promise<PassView> {
    const db = await deps.db();
    const account = accountId !== null && UUID.test(accountId) ? accountId : null;
    const res = await db.query<{ k: 'a' | 'd'; season: string; payment_email: string | null; issued_at: Date | string }>(
      `(SELECT 'a' AS k, season, payment_email, issued_at FROM passes
         WHERE attached_user_id = $2::uuid AND ${ACTIVE} AND season >= $1 ORDER BY season, issued_at LIMIT 1)
       UNION ALL
       (SELECT 'd' AS k, season, payment_email, issued_at FROM passes
         WHERE device_id = $3 AND ${UNATTACHED} AND season >= $1 ORDER BY season, issued_at LIMIT 1)`,
      [openSeason(), account, device],
    );
    const a = res.rows.find((r) => r.k === 'a');
    const d = res.rows.find((r) => r.k === 'd');
    return passView({
      signedIn: accountId !== null,
      accountPass: a ? { since: msOf(a.issued_at), season: a.season } : null,
      devicePass: d ? { since: msOf(d.issued_at), season: d.season, email: d.payment_email ?? '' } : null,
    });
  }

  async function passOwnedByEmail(email: string): Promise<boolean> {
    const db = await deps.db();
    const res = await db.query<{ owned: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM passes p JOIN users u ON u.id = p.attached_user_id
          WHERE lower(u.email) = $1 AND u.email_verified AND p.revoked_at IS NULL AND p.erased_at IS NULL AND p.season >= $2
       ) OR EXISTS (
         SELECT 1 FROM passes WHERE payment_email = $1 AND ${UNATTACHED} AND season >= $2
       ) AS owned`,
      [normalizeEmail(email), openSeason()],
    );
    return res.rows[0]?.owned === true;
  }

  async function grantPass(input: { holder: PassHolder; source: PassSource; grantRef: string; issuedAt?: number }): Promise<GrantResult> {
    const db = await deps.db();
    const existing = await byGrantRef(db, input.grantRef);
    if (existing) return { kind: 'granted', pass: existing, created: false };
    const at = input.issuedAt ?? deps.now();
    const season = passSeason(at, deps.season());
    const issued = new Date(at);
    let inserted: Row | undefined;
    if ('account' in input.holder) {
      const account = input.holder.account;
      if (!UUID.test(account)) throw new Error('rights: account id is not a uuid');
      const own = await db.query(`SELECT 1 FROM passes WHERE attached_user_id = $1::uuid AND season = $2 AND ${ACTIVE}`, [account, season]);
      if (own.rowCount > 0) return { kind: 'pass-owned' };
      try {
        inserted = (
          await db.query<Row>(
            `INSERT INTO passes (season, source, grant_ref, attached_user_id, issued_at, attached_at)
             VALUES ($1, $2, $3, $4::uuid, $5, $5) ON CONFLICT (grant_ref) DO NOTHING RETURNING ${COLUMNS}`,
            [season, input.source, input.grantRef, account, issued],
          )
        ).rows[0];
      } catch (e) {
        if (uniqueViolation(e, 'passes_one_active_per_account')) return { kind: 'pass-owned' };
        throw e;
      }
    } else {
      const { device } = input.holder;
      const email = normalizeEmail(input.holder.paymentEmail);
      const onDevice = await db.query(`SELECT 1 FROM passes WHERE device_id = $1 AND season = $2 AND ${UNATTACHED}`, [device, season]);
      if (onDevice.rowCount > 0 || (await passOwnedByEmail(email))) return { kind: 'pass-owned' };
      inserted = (
        await db.query<Row>(
          `INSERT INTO passes (season, source, grant_ref, payment_email, device_id, issued_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (grant_ref) DO NOTHING RETURNING ${COLUMNS}`,
          [season, input.source, input.grantRef, email, device, issued],
        )
      ).rows[0];
    }
    if (!inserted) {
      // A concurrent grant with the same `grantRef` won: the same pass.
      const same = await byGrantRef(db, input.grantRef);
      if (!same) throw new Error('rights: pass vanished after a grant_ref conflict');
      return { kind: 'granted', pass: same, created: false };
    }
    const pass = toRecord(inserted);
    await deps.publish(db, holderTargets(pass), 'pass-granted');
    return { kind: 'granted', pass, created: true };
  }

  async function revokePass(grantRef: string): Promise<RevokeResult> {
    const db = await deps.db();
    const res = await db.query<Row>(
      `UPDATE passes SET revoked_at = $2 WHERE grant_ref = $1 AND revoked_at IS NULL RETURNING ${COLUMNS}`,
      [grantRef, new Date(deps.now())],
    );
    if (!res.rows[0]) return { pass: await byGrantRef(db, grantRef), revoked: false };
    const pass = toRecord(res.rows[0]);
    await deps.publish(db, holderTargets(pass), 'pass-revoked');
    return { pass, revoked: true };
  }

  type Attempt = { kind: 'attached'; device: string | null } | { kind: 'mine' } | { kind: 'taken' } | { kind: 'account-has' };

  /** One conditional UPDATE in its own transaction [П-3]. */
  async function tryAttach(db: RightsDb, passId: string, account: string, open: string): Promise<Attempt> {
    try {
      return await db.tx(async (q) => {
        const res = await q.query<{ device_id: string | null }>(
          `UPDATE passes SET attached_user_id = $2::uuid, attached_at = $3
            WHERE id = $1::uuid AND ${UNATTACHED} AND season >= $4 RETURNING device_id`,
          [passId, account, new Date(deps.now()), open],
        );
        if (res.rowCount === 1) return { kind: 'attached', device: res.rows[0]?.device_id ?? null } as const;
        const now = await q.query<{ attached_user_id: string | null }>(
          'SELECT attached_user_id::text AS attached_user_id FROM passes WHERE id = $1::uuid',
          [passId],
        );
        return now.rows[0]?.attached_user_id === account ? ({ kind: 'mine' } as const) : ({ kind: 'taken' } as const);
      });
    } catch (e) {
      if (uniqueViolation(e, 'passes_one_active_per_account')) return { kind: 'account-has' };
      throw e;
    }
  }

  async function attachOnSignIn({ account, device, email }: { account: string; device: string | null; email: string | null }): Promise<AttachResult> {
    const none: AttachResult = { attached: null, from: null };
    if (!UUID.test(account)) return none;
    const db = await deps.db();
    const open = openSeason();
    const own = await db.query(`SELECT 1 FROM passes WHERE attached_user_id = $1::uuid AND ${ACTIVE} AND season >= $2`, [account, open]);
    if (own.rowCount > 0) return none; // AC-8: the device pass stays for the next account without a pass.

    const paths: { from: 'device' | 'email'; sql: string; value: string }[] = [];
    if (device) paths.push({ from: 'device', sql: 'device_id = $1', value: device });
    if (email) paths.push({ from: 'email', sql: 'payment_email = $1', value: normalizeEmail(email) });
    for (const path of paths) {
      const candidates = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM passes WHERE ${path.sql} AND ${UNATTACHED} AND season >= $2 ORDER BY issued_at, id`,
        [path.value, open],
      );
      for (const { id } of candidates.rows) {
        const r = await tryAttach(db, id, account, open);
        if (r.kind === 'account-has') return none;
        if (r.kind === 'taken') continue;
        if (r.kind === 'mine') return { attached: id, from: path.from, ...(path.from === 'email' ? { previousDevice: null } : {}) };
        const targets: PassEventTarget[] = [{ account }];
        if (r.device !== null) targets.push({ device: r.device });
        await deps.publish(db, targets, 'pass-attached');
        return { attached: id, from: path.from, ...(path.from === 'email' ? { previousDevice: r.device } : {}) };
      }
    }
    return none;
  }

  return {
    view,
    hasPass: async (subjectId, device) => (await view({ accountId: subjectId, device })).hasPass,
    grantPass,
    revokePass,
    attachOnSignIn,
    passOwnedByEmail,
  };
}
