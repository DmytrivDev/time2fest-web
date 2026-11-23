/**
 * Realtime ports (ring 2, SPEC-06): technology-neutral interfaces of the realtime transport. Each one is
 * justified by a process boundary (Centrifugo's HTTP API, the request's session), a second implementation
 * (production vs test-door subjects) or a test substitution (signer, random source, scheduler).
 * No implementation lives here and no vendor type (`jose`, `fetch`, `centrifuge`) is named.
 */
import type { RealtimeEnvelope, RealtimeSubjectKind } from '@time2fest/contracts';

/** Who a connection token is issued for (C5). `id` matches `SUBJECT_ID` and is unique across kinds. */
export interface RealtimeSubject {
  kind: RealtimeSubjectKind;
  id: string;
}

/**
 * Finds the subject of a request (C5). Production resolves `null` until sign-in exists (SPEC-10);
 * the test door's resolver returns the subject it was given (AC-57).
 */
export interface SubjectResolver {
  resolve(req: Request): Promise<RealtimeSubject | null>;
}

/** The only claims a connection token carries (AC-12): epoch seconds for `iat` and `exp`. */
export interface TokenClaims {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * The claims of a subscription token (SPEC-12 [П-2]): an anonymous subscriber (`sub` is always empty),
 * one channel, and the `info` Centrifugo attaches to the subscription's presence entry (`chan_info`).
 * Epoch seconds for `exp`.
 */
export interface SubscriptionClaims {
  channel: string;
  info: Record<string, unknown>;
  exp: number;
}

/** Signs connection tokens with the shared Centrifugo secret. */
export interface TokenSigner {
  sign(claims: TokenClaims): Promise<string>;
}

/** Signs subscription tokens with the same secret; `iat` (epoch seconds) comes from the caller's clock. */
export interface SubscriptionSigner {
  signSubscription(claims: SubscriptionClaims & { iat: number }): Promise<string>;
}

/** A uniform value in [0, 1); cryptographic in production, seeded in tests. */
export type RandomSource = () => number;

/** What Centrifugo answered to one publish call. */
export type PublishOutcome =
  | { status: 'ok'; offset?: number; epoch?: string }
  /** Centrifugo answered with an API error code (unknown namespace, bad channel, …). */
  | { status: 'rejected'; code: number }
  /** Network failure, timeout, 5xx or a refused API key. */
  | { status: 'unavailable' };

export interface CentrifugoPublishInput {
  channel: string;
  data: unknown;
  idempotencyKey: string;
}

/** One presence entry as the server reads it: only the subscription's `chan_info`, never a client id. */
export interface PresenceInfo {
  chanInfo?: unknown;
}

/** What Centrifugo answered to one presence call. */
export type PresenceOutcome = { status: 'ok'; entries: PresenceInfo[] } | { status: 'unavailable' };

/** Centrifugo's server API (process boundary). Implementations never throw. */
export interface CentrifugoApi {
  publish(input: CentrifugoPublishInput): Promise<PublishOutcome>;
  disconnectUser(user: string, code: number, reason: string): Promise<'ok' | 'unavailable'>;
}

/** Centrifugo's presence read (SPEC-12 AC-61). Never throws; a namespace without presence reads as unavailable. */
export interface CentrifugoPresenceApi {
  presence(channel: string): Promise<PresenceOutcome>;
}

/** Timers, substituted by a manual scheduler in tests. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Result of publishing into a channel class (C4). */
export type PublishResult =
  | { status: 'ok'; offset?: number; epoch?: string }
  /** Accepted into the batch of a batched class. */
  | { status: 'queued' }
  /** Unknown class, bad key, or an envelope that fails the C3 schema or the size limit. */
  | { status: 'validation' }
  | { status: 'unavailable' };

/** Publishes an envelope into a channel of a registry class (C4). `key` is absent for a fixed class. */
export interface ChannelPublisher {
  publish(classKey: string, key: string | undefined, envelope: RealtimeEnvelope): Promise<PublishResult>;
}

/** Disconnects every connection of a subject with code 3014 so that it reconnects with new rights (C6). */
export interface SubjectInvalidator {
  invalidate(subjectId: string): Promise<'ok' | 'unavailable'>;
}
