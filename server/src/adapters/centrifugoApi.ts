/**
 * Centrifugo server HTTP API (ring 4, SPEC-06 AC-32, AC-36, AC-17): the only file that knows its wire
 * shape. `POST <url>/api/publish` and `POST <url>/api/disconnect` with the `X-API-Key` header.
 *
 * Never throws: every failure is an outcome. Each call is bounded by `CENTRIFUGO_API_TIMEOUT_MS`, below
 * the 2 s the ports promise, so that the caller's overhead still fits (on Windows a refused loopback
 * connect alone retries for about 2 s). The API key, the URL (it may carry credentials) and request or
 * response bodies are never logged; the only line written here is an `error` for a refused key.
 */
import type { Logger } from '../ports';
import type { CentrifugoApi, CentrifugoPublishInput, PublishOutcome } from '../realtime/ports';

/** Upper bound of one API call, including reading the response body. */
export const CENTRIFUGO_API_TIMEOUT_MS = 1_800;

export interface CentrifugoApiOptions {
  /** Base URL of Centrifugo, e.g. `http://127.0.0.1:8000`. */
  url: string;
  apiKey: string;
  log: Logger;
}

type ApiReply =
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; code: number }
  | { kind: 'unavailable' };

export function createCentrifugoApi({ url, apiKey, log }: CentrifugoApiOptions): CentrifugoApi {
  const base = url.replace(/\/+$/, '');

  async function call(method: 'publish' | 'disconnect', body: unknown): Promise<ApiReply> {
    try {
      const res = await fetch(`${base}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(body),
        // A redirect would re-send the API key to wherever it points: refused, so it reads as unavailable.
        redirect: 'error',
        signal: AbortSignal.timeout(CENTRIFUGO_API_TIMEOUT_MS),
      });
      if (res.status === 401) {
        // A misconfigured key: an operator problem, reported without the key.
        log.error({ event: 'realtime_api_key_refused', method });
        await res.body?.cancel();
        return { kind: 'unavailable' };
      }
      if (res.status !== 200) {
        await res.body?.cancel();
        return { kind: 'unavailable' };
      }
      const json = (await res.json()) as { result?: unknown; error?: { code?: unknown } } | null;
      if (json !== null && typeof json === 'object' && json.error !== undefined) {
        const code = typeof json.error?.code === 'number' ? json.error.code : 0;
        return { kind: 'error', code };
      }
      const result = json !== null && typeof json === 'object' && typeof json.result === 'object' && json.result !== null ? json.result : {};
      return { kind: 'result', result: result as Record<string, unknown> };
    } catch {
      // Timeout, refused connection, DNS, a body that is not JSON: all mean Centrifugo is not usable now.
      return { kind: 'unavailable' };
    }
  }

  return {
    async publish({ channel, data, idempotencyKey }: CentrifugoPublishInput): Promise<PublishOutcome> {
      const reply = await call('publish', { channel, data, idempotency_key: idempotencyKey });
      if (reply.kind === 'unavailable') return { status: 'unavailable' };
      if (reply.kind === 'error') return { status: 'rejected', code: reply.code };
      const { offset, epoch } = reply.result;
      return {
        status: 'ok',
        ...(typeof offset === 'number' ? { offset } : {}),
        ...(typeof epoch === 'string' ? { epoch } : {}),
      };
    },

    async disconnectUser(user: string, code: number, reason: string): Promise<'ok' | 'unavailable'> {
      const reply = await call('disconnect', { user, disconnect: { code, reason } });
      return reply.kind === 'result' ? 'ok' : 'unavailable';
    },
  };
}
