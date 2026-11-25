/**
 * The auth scope (SPEC-10 W23, W29, W40; review A10-03): the one `AsyncLocalStorage` that carries per-request state
 * into Better Auth's callbacks, which our code does not call directly.
 * - `active`: the hooks of `events.ts` (session events) and `merge.ts` (guest handlers) act only inside a scope opened
 *   by `runInAuthScope` — middleware `25-subject` for every request, and every job that touches sessions (erase,
 *   guest cleanup). Outside a scope they do nothing (a BA call from a test or script publishes nothing).
 * - `code`: the state of one code request or verify (`codeFlow.ts`): mail outcome, "user created".
 * - `subjectDeps`: the deps of a subject-data call (`runSubjectDataInScope`), because the registry handler takes only
 *   a subject id.
 * Wiring-time deps (mail, realtime, log, env) do NOT travel here: Better Auth is built with a `getDeps` getter
 * (`createAuthWiring`).
 * The store lives on `globalThis[Symbol.for(...)]`: Next bundles modules more than once, and the Better Auth instance
 * (built from the deps singleton) may call into another module copy than the one that opened the scope (P10).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Deps } from '../endpoints/types';
import type { MailSendResult } from '../mail/ports';

export interface CodeRequestState {
  /**
   * Set by `sendSignInCode` (or `substituteSender`). Absent = the sender never finished: Better Auth's
   * `runInBackgroundOrAwait` swallows a throw of the callback and still answers 200, so absence means «not delivered».
   */
  mail?: MailSendResult;
  /** Set by the `user.create.after` hook during a verify. */
  userCreated?: boolean;
}

export interface AuthScope {
  readonly active: boolean;
  readonly code?: CodeRequestState;
  readonly subjectDeps?: Deps;
}

const SCOPE_KEY = Symbol.for('t2f.auth.requestScope');
const store: AsyncLocalStorage<AuthScope> = ((globalThis as Record<symbol, unknown>)[SCOPE_KEY] ??=
  new AsyncLocalStorage<AuthScope>()) as AsyncLocalStorage<AuthScope>;

/** Runs `fn` inside an auth scope: Better Auth's session and link hooks act during it. */
export function runInAuthScope<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ ...store.getStore(), active: true }, fn);
}

/** Runs `fn` inside an auth scope that also carries the deps of a subject-data call. */
export function runInSubjectDataScope<T>(deps: Deps, fn: () => Promise<T>): Promise<T> {
  return store.run({ ...store.getStore(), active: true, subjectDeps: deps }, fn);
}

/** Runs one code request or verify with its own state; the enclosing scope (if any) stays as it was. */
export function runCodeRequest<T>(state: CodeRequestState, fn: () => Promise<T>): Promise<T> {
  const current = store.getStore();
  return store.run({ active: current?.active ?? false, ...(current?.subjectDeps ? { subjectDeps: current.subjectDeps } : {}), code: state }, fn);
}

/** Whether the current async context is inside `runInAuthScope`. */
export function inAuthScope(): boolean {
  return store.getStore()?.active === true;
}

/** The state of the code request in flight, if any. */
export function codeRequestState(): CodeRequestState | undefined {
  return store.getStore()?.code;
}

/** The deps of the subject-data call in flight; throws outside `runSubjectDataInScope`. */
export function requireSubjectDataDeps(): Deps {
  const deps = store.getStore()?.subjectDeps;
  if (deps === undefined) throw new Error('auth subject data outside runInAuthScope');
  return deps;
}
