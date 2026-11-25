/**
 * Session events (SPEC-10 W29, [П-5], AC-29): when a session is created or ended, the subject's personal channel
 * `user:#<id>` gets `{type:'session', id, data:{reason}}` and `invalidateSubject(id)` reconnects its connections with
 * new rights (SPEC-06 C6).
 * Spike S1: Better Auth's `session.delete.after` fires per session on `/sign-out`, `revokeSessions`,
 * `internalAdapter.deleteUser` AND on the guest deletion after a link — so `signed-out` is published only from that
 * hook (the old subject of a merge is covered by it); `signed-in` from `session.create.after` for non-guest sessions.
 * Better Auth's hooks do not know our `Deps`: every request runs inside `runInAuthScope` (middleware `25-subject`),
 * a job that touches sessions must wrap its work the same way (P13: erase, guest cleanup). Outside a scope the hooks
 * publish nothing.
 * A failed publication is logged (`event:'session-publish'`) and never fails the sign-in; nothing here throws.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { SessionEvent, SessionEventReason } from '@time2fest/contracts';
import type { Deps } from '../endpoints/types';

// One store per process on `globalThis`: Next bundles this module more than once, and the Better Auth hooks (built
// from the deps singleton) may belong to another copy than the middleware that opened the scope.
const SCOPE_KEY = Symbol.for('t2f.auth.scope');
const scope: AsyncLocalStorage<Deps> = ((globalThis as Record<symbol, unknown>)[SCOPE_KEY] ??=
  new AsyncLocalStorage<Deps>()) as AsyncLocalStorage<Deps>;

/** The guest-creation path of Better Auth: a guest session is not a sign-in. */
const GUEST_PATH = '/sign-in/anonymous';

/** Runs `fn` with `deps` visible to the Better Auth hooks of this module and of `merge.ts`. */
export function runInAuthScope<T>(deps: Deps, fn: () => Promise<T>): Promise<T> {
  return scope.run(deps, fn);
}

/** The deps of the current auth scope, if any. */
export function authScopeDeps(): Deps | undefined {
  return scope.getStore();
}

/** Publishes the `session` event to `user:#<subjectId>` and invalidates the subject. Never throws. */
export async function publishSessionEvent(deps: Deps, subjectId: string, reason: SessionEventReason): Promise<void> {
  const envelope: SessionEvent = { type: 'session', id: randomUUID(), data: { reason } };
  const publisher = deps.realtime?.publisher;
  const invalidator = deps.realtime?.invalidator;
  let result: string;
  try {
    result = publisher ? (await publisher.publish('user', subjectId, envelope)).status : 'not-configured';
  } catch {
    result = 'unavailable';
  }
  let invalidated: string;
  try {
    invalidated = invalidator ? await invalidator.invalidate(subjectId) : 'not-configured';
  } catch {
    invalidated = 'unavailable';
  }
  if (result !== 'ok' || invalidated !== 'ok') {
    try {
      deps.log.warn({ event: 'session-publish', reason, result, invalidate: invalidated });
    } catch {
      // A logger never throws; this keeps the promise to the hooks if one does.
    }
  }
}

function fire(subjectId: unknown, reason: SessionEventReason): void {
  const deps = scope.getStore();
  if (deps === undefined || typeof subjectId !== 'string' || subjectId === '') return;
  // Not awaited: Centrifugo never delays a sign-in or a sign-out.
  void publishSessionEvent(deps, subjectId, reason).catch(() => undefined);
}

/** `databaseHooks.session.create.after`: `signed-in` for every session except a new guest's. */
export function onSessionCreated(session: { userId?: unknown }, ctx: { path?: string } | null | undefined): void {
  if (ctx?.path === GUEST_PATH) return;
  fire(session.userId, 'signed-in');
}

/** `databaseHooks.session.delete.after`: `signed-out` (sign-out, revoke, user deletion, guest removed after a link). */
export function onSessionDeleted(session: { userId?: unknown }): void {
  fire(session.userId, 'signed-out');
}
