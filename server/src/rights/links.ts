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
 */
import { catalogStoreOf, rightsOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import { rightsDbOf } from '../auth/pool';
import { mergeSchedules, scheduleCatalogFrom } from '../domain/rights/schedule';
import type { AuthLinkHandler } from '../registries/authLinks';
import { publishProfileEvent } from './events';

interface ProfileRow extends Record<string, unknown> {
  nick: string | null;
  nick_key: string | null;
  flag_code: string | null;
  settings: unknown;
  schedule: string[] | null;
}

const objectOf = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const bansLink: AuthLinkHandler = {
  key: 'bans',
  async link({ fromSubject, toSubject, deps }) {
    const db = await rightsDbOf(deps);
    const found = await db.query<{ reason_code: string | null }>(`SELECT reason_code FROM bans WHERE kind = 'guest' AND subject_id = $1 LIMIT 1`, [fromSubject]);
    if (found.rowCount === 0) return;
    await rightsOf(deps).bans.ban({ kind: 'account', subject: toSubject, by: 'merge', reasonCode: found.rows[0]?.reason_code ?? null });
  },
};

/** The guest's device (its own row; else the account's, where `linkGuest` moved it) and the account's verified email. */
async function attachInputs(deps: Deps, guest: string, account: string): Promise<{ device: string | null; email: string | null }> {
  const db = await rightsDbOf(deps);
  const rows = await db.query<{ id: string; device_id: string | null; email: string | null; email_verified: boolean | null }>(
    'SELECT id::text AS id, device_id, email, email_verified FROM users WHERE id::text = ANY($1::text[])',
    [[guest, account]],
  );
  const g = rows.rows.find((r) => r.id === guest);
  const a = rows.rows.find((r) => r.id === account);
  const device = g?.device_id ?? a?.device_id ?? null;
  return { device: device === '' ? null : device, email: a?.email_verified === true && typeof a.email === 'string' ? a.email : null };
}

export const passesLink: AuthLinkHandler = {
  key: 'passes',
  async link({ fromSubject, toSubject, deps }) {
    const { device, email } = await attachInputs(deps, fromSubject, toSubject);
    await rightsOf(deps).passes.attachOnSignIn({ account: toSubject, device, email });
  },
};

export const profileLink: AuthLinkHandler = {
  key: 'profile',
  async link({ fromSubject, toSubject, deps }) {
    const db = await rightsDbOf(deps);
    const peek = await db.query<{ n: number }>('SELECT cardinality(schedule)::int AS n FROM profiles WHERE subject_id = $1', [fromSubject]);
    if (peek.rowCount === 0) return;
    // The catalog is read only when there is a guest schedule to merge (outside the transaction: no lock held meanwhile).
    const cat = (peek.rows[0]?.n ?? 0) > 0 ? scheduleCatalogFrom(await catalogStoreOf(deps).read()) : null;
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
    if (moved) await publishProfileEvent(deps, toSubject);
  },
};
