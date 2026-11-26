/**
 * Rights test doors (SPEC-11 W34, AC-62, [П-15]). Part of the doors module: loaded only through the dynamic doors
 * `import()`, so they exist only in the `test` class with `T2F_TEST_DOORS=1`.
 *
 * - `POST /api/_test/rights/pass-grant {holder, source, grantRef, issuedAt?}` — `grantPass`; `holder.device:'current'`
 *   is the caller's device cookie (the http suite grants to its own jar). A holder that already has a pass →
 *   `conflict/pass-owned`.
 * - `POST /api/_test/rights/pass-revoke {grantRef}` — `revokePass`; unknown ref → `not_found`.
 * - `POST /api/_test/rights/ban {kind, subject}` — `account`/`guest`/`device` through the ban service (`device:'current'`
 *   = the caller's device); `ip-day` marks a fingerprint until 00:00 UTC (`'current'` = the caller's own).
 * - `POST /api/_test/rights/profile-seed {subject, nick?, flagCode?, schedule?, settings?}` — writes the profile row as
 *   given (no catalog check); a nick another subject holds → `conflict/taken`.
 * - `POST /api/_test/rights/link-fault {handler}` — the next run of that `authLinks` row throws once; undone by `reset`.
 * - `POST /api/_test/rights/fixture {name}` — a named preset (`RIGHTS_FIXTURES`); answers the ids it made. The door
 *   needs a subject, so the caller holds a session (a guest when it had none) — `merge-pair` uses that guest.
 *
 * `reset` empties `passes`, `bans`, `profiles` (`clearRightsTables`); the `ban:*` keys go with the prefix wipe.
 */
import {
  rightsBanDoor,
  rightsFixtureDoor,
  rightsLinkFaultDoor,
  rightsPassGrantDoor,
  rightsPassRevokeDoor,
  rightsProfileSeedDoor,
} from '@time2fest/contracts/schemas';
import type { z } from 'zod';
import { authPool } from '../auth/pool';
import { nickDisplay, nickKey } from '../domain/rights/nick';
import { rightsOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Ctx, Deps, Outcome } from '../endpoints/types';
import { authLinkRegistry, type AuthLinkHandler } from '../registries/authLinks';
import { createBanMarks, isFingerprint } from '../rights/banMarks';
import type { PassHolder, PassSource } from '../rights/passes';
import type { DoorRow } from './registry';

const SOURCES: readonly PassSource[] = ['purchase', 'gift', 'admin'];
const BY = 'test-door';
const CURRENT = 'current';
const INVALID = failure('validation', { reason: 'invalid-input' });

/** Fixture values (invented; the sim keeps no fixed pass seed — its suites make fresh addresses). */
export const RIGHTS_FIXTURE_VALUES = {
  accountEmail: 'pass-account@example.com',
  devicePaymentEmail: 'pass-device@example.com',
  attachedEmail: 'pass-attached@example.com',
  bannedEmail: 'ban-account@example.com',
  mergeEmail: 'merge-account@example.com',
  mergeAccountNick: 'Олена',
  mergeAccountFlag: 'UA',
  mergeGuestFlag: 'PL',
} as const;

export const RIGHTS_FIXTURES = [
  'ban-account',
  'ban-device',
  'ban-guest',
  'ban-ip-day',
  'merge-pair',
  'pass-account',
  'pass-attached',
  'pass-device',
] as const;
export type RightsFixture = (typeof RIGHTS_FIXTURES)[number];

/** Empties the rights tables (reset door); no-op when sign-in is not wired into these deps. */
export async function clearRightsTables(deps: Deps): Promise<void> {
  if (!deps.auth) return;
  const pool = await authPool(deps);
  await pool.query('DELETE FROM passes; DELETE FROM bans; DELETE FROM profiles;');
}

/** The undo of an armed link fault (one per process). */
let pendingFault: (() => void) | undefined;

/** Arms a one-shot throw on the `authLinks` row `key` of `deps` (the deps the sign-in hooks read). */
export function armLinkFault(deps: Deps, key: string): boolean {
  const rows = deps.authLinks ?? authLinkRegistry;
  if (!rows.some((r) => r.key === key)) return false;
  pendingFault?.();
  const had = Object.prototype.hasOwnProperty.call(deps, 'authLinks');
  const before = deps.authLinks;
  const restore = () => {
    if (had) deps.authLinks = before;
    else delete (deps as { authLinks?: unknown }).authLinks;
    pendingFault = undefined;
  };
  const faulty = (row: AuthLinkHandler): AuthLinkHandler => ({
    key: row.key,
    async link() {
      restore();
      throw new Error('test link fault');
    },
  });
  deps.authLinks = rows.map((r) => (r.key === key ? faulty(r) : r));
  pendingFault = restore;
  return true;
}

/** Undoes a link fault no merge consumed (reset door). */
export function restoreLinkFault(): void {
  pendingFault?.();
}

async function upsertAccount(deps: Deps, email: string): Promise<string> {
  const pool = await authPool(deps);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, email_verified, is_anonymous) VALUES ('', $1, true, false)
     ON CONFLICT (email) DO UPDATE SET email_verified = true RETURNING id::text AS id`,
    [email],
  );
  return r.rows[0]!.id;
}

async function insertGuest(deps: Deps): Promise<string> {
  const pool = await authPool(deps);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, email_verified, is_anonymous)
     VALUES ('', 'temp-' || pg_catalog.gen_random_uuid()::text || '@guest.time2fest.test', false, true) RETURNING id::text AS id`,
  );
  return r.rows[0]!.id;
}

type SeedInput = z.infer<typeof rightsProfileSeedDoor>;

async function seedProfile(deps: Deps, p: SeedInput): Promise<'ok' | 'taken'> {
  const pool = await authPool(deps);
  const nick = p.nick === undefined ? null : nickDisplay(p.nick) || null;
  try {
    await pool.query(
      `INSERT INTO profiles (subject_id, nick, nick_key, flag_code, settings, schedule, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], now())
       ON CONFLICT (subject_id) DO UPDATE SET nick = EXCLUDED.nick, nick_key = EXCLUDED.nick_key,
         flag_code = EXCLUDED.flag_code, settings = EXCLUDED.settings, schedule = EXCLUDED.schedule, updated_at = now()`,
      [p.subject, nick, nick === null ? null : nickKey(nick), p.flagCode ?? null, JSON.stringify(p.settings ?? {}), p.schedule ?? []],
    );
    return 'ok';
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return 'taken';
    throw err;
  }
}

async function grant(deps: Deps, holder: PassHolder, grantRef: string): Promise<string> {
  const r = await rightsOf(deps).passes.grantPass({ holder, source: 'admin', grantRef });
  if (r.kind !== 'granted') throw new Error('fixture: the holder already has a pass');
  return r.pass.id;
}

/** Applies one preset; the value names the ids it made. */
async function applyFixture(ctx: Ctx, name: RightsFixture): Promise<Outcome> {
  const deps = ctx.deps;
  const v = RIGHTS_FIXTURE_VALUES;
  const { passes, bans } = rightsOf(deps);
  switch (name) {
    case 'pass-account': {
      const accountId = await upsertAccount(deps, v.accountEmail);
      const passId = await grant(deps, { account: accountId }, 'fixture-pass-account');
      return { ok: true, value: { accountId, email: v.accountEmail, passId } };
    }
    case 'pass-device': {
      const passId = await grant(deps, { device: ctx.device, paymentEmail: v.devicePaymentEmail }, `fixture-pass-device-${ctx.device}`);
      return { ok: true, value: { device: ctx.device, email: v.devicePaymentEmail, passId } };
    }
    case 'pass-attached': {
      const accountId = await upsertAccount(deps, v.attachedEmail);
      const passId = await grant(deps, { device: ctx.device, paymentEmail: v.attachedEmail }, `fixture-pass-attached-${ctx.device}`);
      const r = await passes.attachOnSignIn({ account: accountId, device: ctx.device, email: v.attachedEmail });
      if (r.attached !== passId) throw new Error('fixture: the pass did not attach');
      return { ok: true, value: { accountId, email: v.attachedEmail, device: ctx.device, passId } };
    }
    case 'ban-account': {
      const accountId = await upsertAccount(deps, v.bannedEmail);
      const { ban } = await bans.ban({ kind: 'account', subject: accountId, by: BY });
      return { ok: true, value: { accountId, email: v.bannedEmail, banId: ban.id } };
    }
    case 'ban-guest': {
      const guestId = await insertGuest(deps);
      const { ban } = await bans.ban({ kind: 'guest', subject: guestId, by: BY });
      return { ok: true, value: { guestId, banId: ban.id } };
    }
    case 'ban-device': {
      const { ban } = await bans.ban({ kind: 'device', subject: ctx.device, by: BY });
      return { ok: true, value: { device: ctx.device, banId: ban.id } };
    }
    case 'ban-ip-day': {
      if (!(await markIpDay(ctx, CURRENT))) return INVALID;
      return { ok: true, value: {} };
    }
    case 'merge-pair': {
      if (ctx.subject === undefined || ctx.subjectKind !== 'guest') return failure('conflict', { reason: 'not-guest' });
      const guestId = ctx.subject;
      const accountId = await upsertAccount(deps, v.mergeEmail);
      if ((await seedProfile(deps, { subject: accountId, nick: v.mergeAccountNick, flagCode: v.mergeAccountFlag })) !== 'ok') {
        return failure('conflict', { reason: 'taken' });
      }
      await seedProfile(deps, { subject: guestId, flagCode: v.mergeGuestFlag, settings: { hour12: true } });
      return { ok: true, value: { accountId, email: v.mergeEmail, guestId } };
    }
  }
}

/** Marks `subject` (`'current'` = the caller's fingerprint) as banned now until 00:00 UTC; false for a non-fingerprint. */
async function markIpDay(ctx: Ctx, subject: string): Promise<boolean> {
  const fp = subject === CURRENT ? await ctx.client.ipDay() : subject;
  if (!isFingerprint(fp)) return false;
  const now = ctx.deps.clock.now();
  await createBanMarks(() => ctx.deps.redis).markFp(fp, now, now);
  return true;
}

/** Rows sorted by key (`rights-*`); the registry spreads them in place. */
export const rightsDoors: readonly DoorRow[] = [
  {
    key: 'rights-ban',
    method: 'POST',
    path: '/api/_test/rights/ban',
    body: rightsBanDoor,
    async handler(ctx) {
      const { kind, subject } = ctx.body as z.infer<typeof rightsBanDoor>;
      if (kind === 'ip-day') return (await markIpDay(ctx, subject)) ? { ok: true, value: {} } : INVALID;
      const target = kind === 'device' && subject === CURRENT ? ctx.device : subject;
      const { ban, created } = await rightsOf(ctx.deps).bans.ban({ kind, subject: target, by: BY });
      return { ok: true, value: { banId: ban.id, created } };
    },
  },
  {
    key: 'rights-fixture',
    method: 'POST',
    path: '/api/_test/rights/fixture',
    body: rightsFixtureDoor,
    subject: 'required',
    async handler(ctx) {
      const { name } = ctx.body as z.infer<typeof rightsFixtureDoor>;
      if (!(RIGHTS_FIXTURES as readonly string[]).includes(name)) return failure('not_found');
      return applyFixture(ctx, name as RightsFixture);
    },
  },
  {
    key: 'rights-link-fault',
    method: 'POST',
    path: '/api/_test/rights/link-fault',
    body: rightsLinkFaultDoor,
    async handler(ctx, { deps }) {
      const { handler } = ctx.body as z.infer<typeof rightsLinkFaultDoor>;
      return armLinkFault(deps, handler) ? { ok: true, value: {} } : failure('not_found');
    },
  },
  {
    key: 'rights-pass-grant',
    method: 'POST',
    path: '/api/_test/rights/pass-grant',
    body: rightsPassGrantDoor,
    async handler(ctx) {
      const body = ctx.body as z.infer<typeof rightsPassGrantDoor>;
      if (!(SOURCES as readonly string[]).includes(body.source)) return INVALID;
      const holder: PassHolder =
        'account' in body.holder
          ? { account: body.holder.account }
          : { device: body.holder.device === CURRENT ? ctx.device : body.holder.device, paymentEmail: body.holder.paymentEmail };
      const r = await rightsOf(ctx.deps).passes.grantPass({
        holder,
        source: body.source as PassSource,
        grantRef: body.grantRef,
        ...(body.issuedAt !== undefined ? { issuedAt: body.issuedAt } : {}),
      });
      if (r.kind === 'pass-owned') return failure('conflict', { reason: 'pass-owned' });
      return { ok: true, value: { passId: r.pass.id, created: r.created, season: r.pass.season } };
    },
  },
  {
    key: 'rights-pass-revoke',
    method: 'POST',
    path: '/api/_test/rights/pass-revoke',
    body: rightsPassRevokeDoor,
    async handler(ctx) {
      const { grantRef } = ctx.body as z.infer<typeof rightsPassRevokeDoor>;
      const r = await rightsOf(ctx.deps).passes.revokePass(grantRef);
      if (r.pass === null) return failure('not_found');
      return { ok: true, value: { passId: r.pass.id, revoked: r.revoked } };
    },
  },
  {
    key: 'rights-profile-seed',
    method: 'POST',
    path: '/api/_test/rights/profile-seed',
    body: rightsProfileSeedDoor,
    async handler(ctx) {
      const r = await seedProfile(ctx.deps, ctx.body as SeedInput);
      return r === 'ok' ? { ok: true, value: {} } : failure('conflict', { reason: 'taken' });
    },
  },
];
