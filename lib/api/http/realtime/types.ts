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

export interface RealtimeTransport {
  subscribe(channel: string, listener: RealtimeListener): Unsubscribe;
  state(): ConnectionState;
  onStateChange(listener: (state: ConnectionState) => void): Unsubscribe;
}
