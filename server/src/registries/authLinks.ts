/**
 * Guest-merge handlers (SPEC-10 W30, AC-23, AC-24): when a guest signs in (code or Google), each row moves the
 * guest's data of one capability to the account. Rows are added by the waves that own the data (SPEC-11+); this
 * wave registers none in production. A test injects its own rows through `Deps.authLinks`.
 * Contract of a row: idempotent for `(fromSubject, toSubject)`; may throw — the merge then records a retry row and
 * raises `log` `auth/link-retry`, and the sign-in still completes. Sorted by `key`.
 */
import type { Deps } from '../endpoints/types';
import { assertRegistry } from '../platform/registry';

export interface AuthLinkInput {
  /** The guest's subject id (being removed). */
  fromSubject: string;
  /** The account's subject id. */
  toSubject: string;
  deps: Deps;
}

export interface AuthLinkHandler {
  /** Stable name (`[a-z0-9-]{1,48}`): the idempotency key, the retry row and the alarm detail use it. */
  key: string;
  link(input: AuthLinkInput): Promise<void>;
}

export const authLinkRegistry: readonly AuthLinkHandler[] = [];

assertRegistry('authLinks', authLinkRegistry, (h) => h.key);
