/**
 * Better Auth glue of the cabinet's account routes (SPEC-11 W31, W32, [П-11], [П-12], [А11], [А12]).
 * - `startGoogleLink` (`POST /api/me/google`, AC-46): Better Auth's core `/link-social` with a body WE build
 *   (`googleLinkBody`: provider `google`, return path cut to our own site, link marks, no redirect) and the session of
 *   the request; answers `{kind:'redirect', url}` with Better Auth's state cookie. The OAuth `state` of the link is
 *   remembered in Redis (`auth:glink:<state>` → account + return path, 10 min) so the callback can tell a link.
 * - `finishGoogleLink` (callback of a link): success → `profile` event to the account; Better Auth's error redirects are
 *   mapped by `googleCallbackLocation`. A concurrent link of the same Google id by another account loses on the unique
 *   index `user_accounts_provider_account_uq` (AC-47): Better Auth's insert throws (no redirect, 5xx) — answered with a
 *   redirect to the return path with `error=google-taken`.
 * - `unlinkGoogle` (`DELETE /api/me/google`, AC-48): our own rule, not Better Auth's `/unlink-account` (it counts only
 *   provider rows, research-better-auth §4): methods = verified email + providers; refused `conflict/last-method` only
 *   when Google is the sole method.
 * - `emailChangePorts`: Better Auth's internal adapter + our code limits, mail and events for `rights/emailChange.ts`.
 * No token, email or code is logged or answered.
 */
import { randomUUID } from 'node:crypto';
import { canUnlink, signInMethods } from '../domain/rights/signInMethods';
import { authOf, mailOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Ctx, Deps, Outcome } from '../endpoints/types';
import { changeEmailCodeMail } from '../mail/templates/changeEmailCode';
import type { EmailChangePorts } from '../rights/emailChange';
import { publishProfileEvent } from '../rights/events';
import { admitCode, commitCode, releaseCode, type CodeLimitKeys } from './codeLimits';
import { publishSessionEvent } from './events';
import { GOOGLE_CALLBACK_PATH, GOOGLE_LINK_PATH, GOOGLE_PROVIDER_ID, googleCallbackLocation, googleLinkBody, linkReturnPath } from './google';
import { AUTH_BASE_PATH, authBaseUrl } from './instance';
import { forwardHeaders } from './request';
import { clampSessionCookies, envelope, mapError, sessionCookieName } from './response';

const LINK_TTL_MS = 600_000;
const linkKey = (state: string) => `auth:glink:${state}`;

interface LinkRecord {
  u: string;
  p: string;
}

async function internal(deps: Deps) {
  return (await authOf(deps).instance().$context).internalAdapter;
}

async function errorCodeOf(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** `POST /api/me/google {returnPath}` for the account `userId` of the request's session. */
export async function startGoogleLink(ctx: Ctx, userId: string, returnPath: string): Promise<Outcome> {
  const wiring = authOf(ctx.deps);
  const auth = wiring.instance();
  const headers = await forwardHeaders(ctx);
  headers.set('content-type', 'application/json');
  const url = new URL(`${AUTH_BASE_PATH}${GOOGLE_LINK_PATH}`, authBaseUrl(ctx.env));
  const res = await auth.handler(new Request(url, { method: 'POST', headers, body: googleLinkBody(returnPath) }));
  if (res.status === 404 && (await errorCodeOf(res.clone())) === 'PROVIDER_NOT_FOUND') return failure('unavailable');
  if (res.status >= 400) return mapError(ctx, res);
  const value = (await res.json()) as { url?: unknown } | null;
  const target = typeof value?.url === 'string' ? value.url : undefined;
  if (target === undefined) return failure('unavailable');
  let state: string | null = null;
  try {
    state = new URL(target).searchParams.get('state');
  } catch {
    state = null;
  }
  if (state !== null && state !== '') {
    const record: LinkRecord = { u: userId, p: linkReturnPath(returnPath) };
    try {
      await ctx.deps.redis.set(linkKey(state), JSON.stringify(record), LINK_TTL_MS);
    } catch {
      // Best effort: without the record only the AC-47 race answer falls back to Better Auth's own error.
      ctx.log.warn({ event: 'google-link', outcome: 'state-not-kept' });
    }
  }
  const cookies = new Headers();
  clampSessionCookies(res.headers, cookies, await sessionCookieName(auth), wiring);
  return envelope({ kind: 'redirect', url: target }, 200, cookies);
}

function withError(path: string, reason: string): string {
  const hashAt = path.indexOf('#');
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  return `${base}${base.includes('?') ? '&' : '?'}error=${reason}${hash}`;
}

async function hasGoogle(deps: Deps, userId: string): Promise<boolean> {
  const accounts = await (await internal(deps)).findAccounts(userId);
  return accounts.some((a) => a.providerId === GOOGLE_PROVIDER_ID);
}

/**
 * After Better Auth answered `GET /api/auth/callback/google`: `undefined` when the callback is not a link (or its
 * answer needs no change — the caller shapes it as usual); a redirect for the race loser (AC-47). Never throws.
 */
export async function finishGoogleLink(ctx: Ctx, res: Response): Promise<Outcome | undefined> {
  if (ctx.url.pathname !== `${AUTH_BASE_PATH}${GOOGLE_CALLBACK_PATH}`) return undefined;
  const state = ctx.url.searchParams.get('state');
  if (state === null || state === '') return undefined;
  let record: LinkRecord | undefined;
  try {
    const raw = await ctx.deps.redis.get(linkKey(state));
    if (raw === null) return undefined;
    record = JSON.parse(raw) as LinkRecord;
    await ctx.deps.redis.del(linkKey(state));
  } catch {
    if (record === undefined) return undefined;
  }
  try {
    if (res.status >= 300 && res.status < 400) {
      const location = googleCallbackLocation(res.headers.get('location'), authBaseUrl(ctx.env), AUTH_BASE_PATH);
      if (!/[?&]error=/.test(location)) await publishProfileEvent(ctx.deps, record.u);
      return undefined;
    }
    if (res.status >= 500) {
      // The unique (provider_id, account_id) index refused this link: another account took this Google id meanwhile.
      const linked = await hasGoogle(ctx.deps, record.u).catch(() => false);
      ctx.log.warn({ event: 'google-link', outcome: linked ? 'failed' : 'taken' });
      return new Response(null, { status: 302, headers: { location: withError(record.p, linked ? 'failed' : 'google-taken') } });
    }
  } catch {
    ctx.log.warn({ event: 'google-link', outcome: 'finish-failed' });
  }
  return undefined;
}

export type LinkResult = { ok: true; value: null } | { ok: false; error: { code: 'unauthorized' | 'conflict'; reason?: string } };

/** `DELETE /api/me/google`: removes the account's Google rows unless Google is its only sign-in method. */
export async function unlinkGoogle(deps: Deps, userId: string): Promise<LinkResult> {
  const adapter = await internal(deps);
  const user = (await adapter.findUserById(userId)) as { isAnonymous?: boolean | null; emailVerified?: boolean } | null;
  if (user === null || user.isAnonymous === true) return { ok: false, error: { code: 'unauthorized' } };
  const accounts = await adapter.findAccounts(userId);
  const google = accounts.filter((a) => a.providerId === GOOGLE_PROVIDER_ID);
  if (google.length === 0) return { ok: true, value: null };
  const methods = signInMethods({
    isAnonymous: false,
    emailVerified: user.emailVerified === true,
    providerIds: accounts.map((a) => a.providerId),
  });
  if (!canUnlink(methods, GOOGLE_PROVIDER_ID)) return { ok: false, error: { code: 'conflict', reason: 'last-method' } };
  for (const a of google) await adapter.deleteAccount(a.id);
  await publishProfileEvent(deps, userId);
  return { ok: true, value: null };
}

/** The ports of the email-change service for one request (limits need its device and address). */
export async function emailChangePorts(ctx: Ctx): Promise<EmailChangePorts> {
  const deps = ctx.deps;
  const wiring = authOf(deps);
  const adapter = await internal(deps);
  const stores = { fast: deps.redis, memory: deps.memory };
  const ipDay = await ctx.client.ipDay();
  const ip48Day = await ctx.client.ip48Day();
  const keys = (email: string): CodeLimitKeys => ({ email: wiring.emailKey(email), device: ctx.device, ipDay, ip48Day });
  return {
    async account(userId) {
      const user = (await adapter.findUserById(userId)) as { email?: string | null; isAnonymous?: boolean | null } | null;
      if (user === null) return null;
      return { email: typeof user.email === 'string' ? user.email : null, isAnonymous: user.isAnonymous === true };
    },
    async emailOwner(email) {
      const found = await adapter.findUserByEmail(email);
      return found?.user.id ?? null;
    },
    async setEmail(userId, email) {
      await adapter.updateUser(userId, { email, emailVerified: true });
    },
    pending: {
      async store(identifier, value, expiresAt) {
        await adapter.deleteVerificationByIdentifier(identifier);
        await adapter.createVerificationValue({ identifier, value, expiresAt: new Date(expiresAt) });
      },
      async consume(identifier) {
        const row = await adapter.consumeVerificationValue(identifier);
        if (!row) return null;
        return { value: String(row.value), expiresAt: new Date(row.expiresAt).getTime() };
      },
      async remove(identifier) {
        await adapter.deleteVerificationByIdentifier(identifier);
      },
    },
    async removeSignInCode(email) {
      await adapter.deleteVerificationByIdentifier(`sign-in-otp-${email}`);
    },
    limits: {
      admit: (email, nowMs) => admitCode(stores, keys(email), nowMs),
      commit: (email, nowMs) => commitCode(stores, keys(email), nowMs),
      release: (email, nowMs) => releaseCode(stores, keys(email), nowMs),
    },
    async send(to, code) {
      const from = String(deps.env.vars.T2F_MAIL_FROM ?? 'Time2Fest <code@mail.time2fest.com>');
      return mailOf(deps).send(changeEmailCodeMail({ code, id: randomUUID(), from, to }));
    },
    async publishChanged(userId) {
      await publishSessionEvent(deps, userId, 'email-changed');
      await publishProfileEvent(deps, userId);
    },
    publishProfile: (userId) => publishProfileEvent(deps, userId),
    now: () => wiring.now(),
    log: { warn: (entry) => ctx.log.warn(entry) },
  };
}
