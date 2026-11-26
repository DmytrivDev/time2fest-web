/**
 * Guest → account merge rows of the rights capabilities (SPEC-11 W26; AC-19, AC-49, AC-51 … AC-53, EC-7; FR-ID-12).
 * Registered in `registries/authLinks.ts`; run by `linkGuest` (`auth/merge.ts`) once per `(guest, row)` and by the
 * retry job (`ops/linkRetry.ts`). Each row is idempotent for `(fromSubject, toSubject)` and may throw (→ retry row).
 * - `bans`: a banned guest → the account is banned (`created_by:'merge'`, idempotent by `(kind, subject)`, AC-19).
 * - `passes`: the sign-in finish step for the guest's device — `attachOnSignIn` with the account's VERIFIED email
 *   (path (a) then (b), [П-3]); the pass service publishes `pass-attached`.
 * - `profile`: account-set fields win, unset ones take the guest's (AC-51); the guest's nick moves only when the account
 *   has none, else it is released with the guest row; schedule = `mergeSchedules(account, guest)` (AC-52); the guest
 *   row is removed in the same transaction; `profile` event to the account.
 * Nothing here logs a nick, an email or a schedule id.
 * Application ring (A3): the rows take `RightsLinkPorts`; `createRightsLinks(portsOf)` turns them into registry rows,
 * the caller (`registries/authLinks.ts`) maps its deps to the ports.
 */
import { mergeSchedules, scheduleCatalogFrom, type ScheduleCatalogSource } from '../domain/rights/schedule';
import type { BanService } from './bans';
import type { PassService } from './passes';
import type { RightsDb } from './ports';

/** What the merge rows need. */
export interface RightsLinkPorts {
  db(): Promise<RightsDb>;
  bans: Pick<BanService, 'ban'>;
  passes: Pick<PassService, 'attachOnSignIn'>;
  /** The stored catalog (read only when a guest schedule is merged). */
  catalog(): Promise<ScheduleCatalogSource>;
  publishProfile(subjectId: string): Promise<void>;
}

/** One merge row over the deps `D` the registry hands it (structural `AuthLinkHandler`). */
export interface RightsLinkRow<D> {
  key: string;
  link(input: { fromSubject: string; toSubject: string; deps: D }): Promise<void>;
}

interface ProfileRow extends Record<string, unknown> {
  nick: string | null;
  nick_key: string | null;
  flag_code: string | null;
  settings: unknown;
  schedule: string[] | null;
}

const objectOf = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function linkBans(p: RightsLinkPorts, fromSubject: string, toSubject: string): Promise<void> {
  const db = await p.db();
  const found = await db.query<{ reason_code: string | null }>(`SELECT reason_code FROM bans WHERE kind = 'guest' AND subject_id = $1 LIMIT 1`, [fromSubject]);
  if (found.rowCount === 0) return;
  await p.bans.ban({ kind: 'account', subject: toSubject, by: 'merge', reasonCode: found.rows[0]?.reason_code ?? null });
}

/** The guest's device (its own row; else the account's, where `linkGuest` moved it) and the account's verified email. */
async function attachInputs(p: RightsLinkPorts, guest: string, account: string): Promise<{ device: string | null; email: string | null }> {
  const db = await p.db();
  const rows = await db.query<{ id: string; device_id: string | null; email: string | null; email_verified: boolean | null }>(
    'SELECT id::text AS id, device_id, email, email_verified FROM users WHERE id::text = ANY($1::text[])',
    [[guest, account]],
  );
  const g = rows.rows.find((r) => r.id === guest);
  const a = rows.rows.find((r) => r.id === account);
  const device = g?.device_id ?? a?.device_id ?? null;
  return { device: device === '' ? null : device, email: a?.email_verified === true && typeof a.email === 'string' ? a.email : null };
}

async function linkPasses(p: RightsLinkPorts, fromSubject: string, toSubject: string): Promise<void> {
  const { device, email } = await attachInputs(p, fromSubject, toSubject);
  await p.passes.attachOnSignIn({ account: toSubject, device, email });
}

async function linkProfile(p: RightsLinkPorts, fromSubject: string, toSubject: string): Promise<void> {
  const db = await p.db();
  const peek = await db.query<{ n: number }>('SELECT cardinality(schedule)::int AS n FROM profiles WHERE subject_id = $1', [fromSubject]);
  if (peek.rowCount === 0) return;
  // The catalog is read only when there is a guest schedule to merge (outside the transaction: no lock held meanwhile).
  const cat = (peek.rows[0]?.n ?? 0) > 0 ? scheduleCatalogFrom(await p.catalog()) : null;
  const moved = await db.tx(async (q) => {
    const cols = 'nick, nick_key, flag_code, settings, schedule';
    const guest = (await q.query<ProfileRow>(`SELECT ${cols} FROM profiles WHERE subject_id = $1 FOR UPDATE`, [fromSubject])).rows[0];
    if (guest === undefined) return false;
    const account = (await q.query<ProfileRow>(`SELECT ${cols} FROM profiles WHERE subject_id = $1 FOR UPDATE`, [toSubject])).rows[0];
    // The guest row goes first: its nick key is free before the account may take it (unique index).
    await q.query('DELETE FROM profiles WHERE subject_id = $1', [fromSubject]);
    const accountNick = account?.nick ?? null;
    const nick = accountNick ?? guest.nick;
    const nickKey = accountNick !== null ? (account?.nick_key ?? null) : guest.nick_key;
    const flag = account?.flag_code ?? guest.flag_code;
    const settings = { ...objectOf(guest.settings), ...objectOf(account?.settings) };
    const guestSchedule = guest.schedule ?? [];
    const accountSchedule = account?.schedule ?? [];
    const schedule = cat !== null && guestSchedule.length > 0 ? mergeSchedules(accountSchedule, guestSchedule, cat) : accountSchedule;
    await q.query(
      `INSERT INTO profiles (subject_id, nick, nick_key, flag_code, settings, schedule, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], now())
       ON CONFLICT (subject_id) DO UPDATE SET nick = EXCLUDED.nick, nick_key = EXCLUDED.nick_key, flag_code = EXCLUDED.flag_code,
         settings = EXCLUDED.settings, schedule = EXCLUDED.schedule, updated_at = now()`,
      [toSubject, nick, nickKey, flag, JSON.stringify(settings), schedule],
    );
    return true;
  });
  if (moved) await p.publishProfile(toSubject);
}

/** The registry rows `bans`, `passes`, `profile` (sorted by key) over `portsOf(deps)`. */
export function createRightsLinks<D>(portsOf: (deps: D) => RightsLinkPorts): RightsLinkRow<D>[] {
  const row = (key: string, run: (p: RightsLinkPorts, from: string, to: string) => Promise<void>): RightsLinkRow<D> => ({
    key,
    link: ({ fromSubject, toSubject, deps }) => run(portsOf(deps), fromSubject, toSubject),
  });
  return [row('bans', linkBans), row('passes', linkPasses), row('profile', linkProfile)];
}
