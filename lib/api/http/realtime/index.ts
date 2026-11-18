/* Realtime transport C7 (SPEC-06): the Centrifugo client side shared by future `http` domain adapters.
   Public surface: the C7 types, the factory and the app-wide lazy instance. No adapter imports it yet. */
import { createRealtimeTransport } from './transport';
import type { RealtimeTransport } from './types';

export type { ConnectionState, RealtimeListener, RealtimeTransport } from './types';
export { createRealtimeTransport } from './transport';

/** Same-origin token endpoint C1. */
export const REALTIME_TOKEN_URL = '/api/realtime/token';

let instance: RealtimeTransport | undefined;

/** One transport per page; `NEXT_PUBLIC_REALTIME_URL` is inlined at build time, unset → never connects (AC-52). */
export function getRealtimeTransport(): RealtimeTransport {
  instance ??= createRealtimeTransport({
    url: process.env.NEXT_PUBLIC_REALTIME_URL,
    tokenUrl: REALTIME_TOKEN_URL,
  });
  return instance;
}
