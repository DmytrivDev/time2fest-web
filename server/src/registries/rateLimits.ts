/**
 * Rate-limit registry (AC-48, AC-62): sorted, unique rows; a route names its row by `key`
 * (`RouteRow.rateLimit`). Empty in SPEC-02; domain waves add their rows.
 */
import type { RateLimitRow } from '../platform/rateLimit';
import { assertRegistry } from '../platform/registry';

/** The limit rows of guest creation: per client (`ipDay`) and per IPv6 /48 (IPv4 /24), S10-08. */
export const GUEST_CREATE_ROW = 'auth-guest-create';
export const GUEST_CREATE_IP48_ROW = 'auth-guest-create-ip48';

export const rateLimitRegistry: readonly RateLimitRow[] = [
  // Sign-in codes (SPEC-10 AC-9, [А4], [П-8], EC-7): 5 codes per 10 min per email key / device / client (ipDay) /
  // IPv6 /48. Keyed rows (`checkKeyedLimit` in `auth/codeLimits.ts`, no route names them): `keys: []` because the
  // caller passes the key value. Reserved atomically before the send, given back only when nothing was sent (S10-01).
  // Refused if Redis is down (NFR-4).
  { key: 'auth-code-device', limit: 5, windowMs: 600_000, keys: [], onStoreDown: 'fail-closed' },
  { key: 'auth-code-email', limit: 5, windowMs: 600_000, keys: [], onStoreDown: 'fail-closed' },
  { key: 'auth-code-ip', limit: 5, windowMs: 600_000, keys: ['ipDay'], onStoreDown: 'fail-closed' },
  { key: 'auth-code-ip48', limit: 5, windowMs: 600_000, keys: [], onStoreDown: 'fail-closed' },
  // Guests created on the first write (SPEC-10 AC-4, [Q2], [П-6]): 60 per 10 min per client; refused if Redis is down.
  { key: GUEST_CREATE_ROW, limit: 60, windowMs: 600_000, keys: ['ipDay'], onStoreDown: 'fail-closed' },
  // The same guests counted per IPv6 /48 (IPv4: /24) too, so rotating /64s inside one /48 does not multiply them
  // (S10-08). 10x the per-client limit: an IPv4 /24 (mobile CGNAT) carries many people. Keyed row (`25-subject`).
  { key: GUEST_CREATE_IP48_ROW, limit: 600, windowMs: 600_000, keys: [], onStoreDown: 'fail-closed' },
  // The author path of the chat card (SPEC-14 AC-54): 60 a minute per device AND per client (ipDay), counted in this
  // process if Redis is down. The ipDay key limits a client that drops the device cookie (a fresh device each request,
  // S14-02).
  { key: 'author-path', limit: 60, windowMs: 60_000, keys: ['device', 'ipDay'], onStoreDown: 'memory' },
  // The public build-time read of the catalog (AC-63): 30 a minute per client (SPEC-05 daily fingerprint),
  // counted in this process if Redis is down.
  { key: 'catalog-read', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Own-subject writes of SPEC-11 (nick check, profile, schedule): 30 a minute per subject, counted in this process
  // if Redis is down (not a security boundary; the email change uses the fail-closed code rows).
  { key: 'chat-nick-check', limit: 30, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  // The public live chains (SPEC-12 AC-3): mostly answered by the edge cache; 600 a minute per client, counted in
  // this process if Redis is down (a public read never fails closed on the fast store).
  { key: 'live-read', limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Player source-error reports (SPEC-12 NFR-4): 10 a minute per client (SPEC-05 daily fingerprint), 429 beyond;
  // counted in this process if Redis is down.
  { key: 'live-source-errors', limit: 10, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Viewer subscription tokens (SPEC-12 [П-2]): 30 a minute per client, as the connection tokens; counted in this
  // process if Redis is down.
  { key: 'live-viewer-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // The email change request (SPEC-11 AC-43, S11-01): 10 per 10 min per subject AND per client (ipDay), on top of
  // the code rows; refused if Redis is down (it answers `taken`, an account-existence signal).
  { key: 'me-email-request', limit: 10, windowMs: 600_000, keys: ['subject', 'ipDay'], onStoreDown: 'fail-closed' },
  // Own-subject profile writes of SPEC-11: 30 a minute per subject, counted in this process if Redis is down.
  { key: 'me-profile', limit: 30, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  { key: 'me-schedule', limit: 30, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  // Presence beats (SPEC-14 AC-5, [А2]): 12 a minute per subject (up to 4 tabs at I = 20 s), counted in this process
  // if Redis is down.
  { key: 'presence-beat', limit: 12, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  // Realtime connection tokens (SPEC-06 AC-16): 30 a minute per client, counted in this process if Redis is down.
  { key: 'realtime-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // The public site snapshot (SPEC-08 AC-3, AC-37): mostly answered by the edge cache, so the origin sees few
  // reads; 600 a minute per client keeps a reload storm or a reader test far below the limit. Counted in this
  // process if Redis is down (a public read never fails closed on the fast store).
  { key: 'site-read', limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
  // Stamp claims (SPEC-14 AC-35): 60 a minute per subject, counted in this process if Redis is down.
  { key: 'stamp-claim', limit: 60, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  // The stream agent's proposals (SPEC-21a AC-37, [А13]): 30 a minute per agent record; refused if Redis is down
  // (a write never counts in one process only). The daily cap lives in `LIVE_DEFAULTS.agent`.
  { key: 'stream-agent-propose', limit: 30, windowMs: 60_000, keys: ['subject'], onStoreDown: 'fail-closed' },
  // The stream agent's reads (SPEC-21a AC-37): 60 a minute per agent record, counted in this process if Redis is down.
  { key: 'stream-agent-read', limit: 60, windowMs: 60_000, keys: ['subject'], onStoreDown: 'memory' },
  // Toast text check (SPEC-09 AC-39, C12): 20 a minute per client, before any AI call; counted in this process if Redis is down.
  { key: 'toasts-check', limit: 20, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' },
];

assertRegistry('rate-limits', rateLimitRegistry, (r) => r.key);
