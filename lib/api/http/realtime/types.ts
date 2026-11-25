/** Client realtime transport contract C7 (SPEC-06). Types only. */
import type { RealtimeEnvelope, Unsubscribe } from '@time2fest/contracts';

/** One subscriber of a channel. */
export interface RealtimeListener {
  /** One call per envelope, batches unpacked, in publication order (AC-46). */
  onEvent(event: RealtimeEnvelope): void;
  /** History could not be recovered after a reconnect: re-read the domain snapshot (AC-42). */
  onResync?(): void;
  /** Centrifugo refused the subscription (code 103); it is not retried (AC-51). */
  onForbidden?(): void;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/** Options of one `subscribe` call (SPEC-12 W44). */
export interface SubscribeOptions {
  /**
   * Subscription token source: while any listener of the channel gives one, the channel's one Centrifugo
   * subscription carries a token (the first such listener's source asks). The token is never stored or logged.
   */
  getToken?: () => Promise<string>;
}

export interface RealtimeTransport {
  subscribe(channel: string, listener: RealtimeListener, options?: SubscribeOptions): Unsubscribe;
  state(): ConnectionState;
  onStateChange(listener: (state: ConnectionState) => void): Unsubscribe;
  /**
   * The session owner may have changed (SPEC-10 AC-31): ask the token endpoint once and, if the subject differs
   * (or the connection is anonymous), reconnect with the new token; channels resubscribe. One request while a
   * renewal runs; nothing happens without an open connection (its next connect asks anyway).
   */
  renewToken(): Promise<void>;
}
