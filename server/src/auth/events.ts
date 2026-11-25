/**
 * Session events (SPEC-10 W29, [П-5], AC-29): when a session is created or ended, the subject's personal channel
 * `user:#<id>` gets `{type:'session', id, data:{reason}}` and `invalidateSubject(id)` reconnects its connections with
 * new rights (SPEC-06 C6).
 * Spike S1: Better Auth's `session.delete.after` fires per session on `/sign-out`, `revokeSessions`,
 * `internalAdapter.deleteUser` AND on the guest deletion after a link — so `signed-out` is published only from that
 * hook (the old subject of a merge is covered by it); `signed-in` from `session.create.after` for non-guest sessions.
 * The hooks get `deps` from the wiring's `getDeps` (`instance.ts`) only inside an auth scope (`scope.ts`): every
 * request runs inside `runInAuthScope` (middleware `25-subject`), a job that touches sessions must wrap its work the
 * same way (P13: erase, guest cleanup). Outside a scope the hooks publish nothing.
 * A failed publication is logged (`event:'session-publish'`) and never fails the sign-in; nothing here throws.
 */
import { randomUUID } from 'node:crypto';
import type { SessionEvent, SessionEventReason } from '@time2fest/contracts';
import type { Deps } from '../endpoints/types';

/** The guest-creation path of Better Auth: a guest session is not a sign-in. */
const GUEST_PATH = '/sign-in/anonymous';

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

function fire(deps: Deps | undefined, subjectId: unknown, reason: SessionEventReason): void {
  if (deps === undefined || typeof subjectId !== 'string' || subjectId === '') return;
  // Not awaited: Centrifugo never delays a sign-in or a sign-out.
  void publishSessionEvent(deps, subjectId, reason).catch(() => undefined);
}

/**
 * `databaseHooks.session.create.after`: `signed-in` for every session except a new guest's. `deps` — the hook deps
 * (undefined outside an auth scope: nothing is published).
 */
export function onSessionCreated(session: { userId?: unknown }, ctx: { path?: string } | null | undefined, deps: Deps | undefined): void {
  if (ctx?.path === GUEST_PATH) return;
  fire(deps, session.userId, 'signed-in');
}

/** `databaseHooks.session.delete.after`: `signed-out` (sign-out, revoke, user deletion, guest removed after a link). */
export function onSessionDeleted(session: { userId?: unknown }, deps: Deps | undefined): void {
  fire(deps, session.userId, 'signed-out');
}
