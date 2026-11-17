/**
 * Channel model and the channel-name builder (SPEC-06 AC-10, AC-18, C8). Ring 1: pure — no clock,
 * no random, no I/O.
 *
 * A channel name is `<namespace>:<prefix><stem><key>`, or `<prefix><stem><key>` for a class without
 * a namespace. The worktree prefix goes after the namespace colon, never before it: Centrifugo picks
 * the namespace by the part before `:`, so a prefix there would break every namespace (DR-2).
 * In `rehearsal` and `production` the prefix is empty and the names equal the seam's §2.6 list.
 */

/** A subject id that may appear in a personal channel or a token `sub` (AC-18). */
export const SUBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A worktree channel prefix `<slug>_` (AC-11); the empty prefix is checked separately. */
export const CHANNEL_PREFIX = /^[a-z0-9_]{1,40}_$/;

/** An ISO 3166-1 alpha-2 country code, the key of `chat:country.<ISO>`. */
export const COUNTRY_KEY = /^[A-Z]{2}$/;

/** The name of a test channel `rttest:<name>`. */
export const RTTEST_NAME = /^[a-z0-9_]{1,40}$/;

export type ChannelShape = 'fixed' | 'keyed' | 'personal';

export type ChannelVisibility = 'public' | 'personal';

/** One channel class of the registry (C8). */
export interface ChannelClassRow {
  /** Stable class key, e.g. `site:state`, `chat:country`, `notif`, `user`, `rttest`. */
  key: string;
  /** Centrifugo namespace, or `null` for a channel without one (`toasts`, `rating`). */
  namespace: string | null;
  /** The fixed part after the namespace and the prefix, before the key (`country.`, `user#`, `#`). */
  stem: string;
  shape: ChannelShape;
  visibility: ChannelVisibility;
  history: { size: number; ttlSeconds: number };
  /** Publications are packed into `batch` envelopes (AC-37). */
  batched: boolean;
  /** Exists only in the `test` class. */
  testOnly?: true;
}

/** The rule a key of `row` must match; `undefined` for a fixed channel, which takes no key. */
function keyPattern(row: ChannelClassRow): RegExp | undefined {
  if (row.shape === 'personal') return SUBJECT_ID;
  if (row.shape === 'keyed') return row.namespace === 'rttest' ? RTTEST_NAME : COUNTRY_KEY;
  return undefined;
}

/** Whether `prefix` is a valid channel prefix: empty, or `<slug>_` (AC-11). */
export function isChannelPrefix(prefix: string): boolean {
  return prefix === '' || CHANNEL_PREFIX.test(prefix);
}

/**
 * The channel name of `row` for `key` under `prefix` (AC-10). Returns `undefined`, never throws, for
 * a key that breaks the class rule (a `:`, `#` or `,` can never pass), a key given to a fixed channel,
 * a missing key of a keyed or personal channel, or a malformed prefix.
 */
export function channelName(row: ChannelClassRow, key: string | undefined, prefix: string): string | undefined {
  if (!isChannelPrefix(prefix)) return undefined;
  const pattern = keyPattern(row);
  if (pattern === undefined) {
    if (key !== undefined) return undefined;
  } else if (key === undefined || !pattern.test(key)) {
    return undefined;
  }
  const rest = `${prefix}${row.stem}${key ?? ''}`;
  return row.namespace === null ? rest : `${row.namespace}:${rest}`;
}
