/**
 * Shared HTTP helpers of the owner's root endpoints under `/cms-api/*` (SPEC-07 C9, SPEC-08, SPEC-12), ring 4.
 * Moved from `cmsEndpoints.ts` unchanged so `liveEndpoints.ts` uses the same rules without an import cycle:
 * the Access gate + `owner` role, `content-type: application/json`, a body of at most 1 KB read before parsing,
 * the strict schema, and the `{ ok: false, error: { code, reason? } }` refusal with `no-store`.
 */
import type { PayloadRequest } from 'payload';
import type { ZodType } from 'zod';
import { hasJsonContentType, passedGate } from '../access/payloadGuard';
import { roleOf } from '../access/policies';
import type { SourcesRefusal } from '../live/sources';

export const NO_STORE = { 'cache-control': 'no-store' };
export const MAX_BODY_BYTES = 1024;

export type Code = 'forbidden' | 'validation' | 'not-found' | 'unavailable';
const STATUS: Record<Code, number> = { forbidden: 403, validation: 400, 'not-found': 404, unavailable: 503 };
export const fail = (code: Code, reason?: string) =>
  Response.json({ ok: false, error: reason ? { code, reason } : { code } }, { status: STATUS[code], headers: NO_STORE });

/** The codes of the stream sources surfaces (SPEC-21a: `invalid`, not the `validation` of SPEC-12). */
export type StreamsCode = SourcesRefusal;
const STREAMS_STATUS: Record<StreamsCode, number> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  'invalid-state': 409,
  'chain-full': 409,
  limit: 429,
  unavailable: 503,
};
/** The refusal of the owner's `/cms-api/streams/*` and the agent's `/cms-api/stream-agent/*` (A21-05). */
export const streamsFail = (code: StreamsCode, reason?: string) =>
  Response.json({ ok: false, error: reason ? { code, reason } : { code } }, { status: STREAMS_STATUS[code], headers: NO_STORE });

/** Owner who passed the Access gate (or a server-side call carrying an owner user). */
export const isOwner = (req: PayloadRequest) => passedGate(req) && roleOf(req.user) === 'owner';

/**
 * The stream agent (SPEC-21a AC-31 … AC-33) who passed the Access gate: the role is read from this request's user,
 * which Payload looks up by the API key on every request (no cache), so a revoked key fails here at once (AC-38).
 */
export const isStreamAgent = (req: PayloadRequest) => passedGate(req) && roleOf(req.user) === 'stream-agent';

/** The body as text, read at most `MAX_BODY_BYTES + 1` bytes; `null` when it is longer than the limit. */
export async function boundedText(req: PayloadRequest): Promise<string | null> {
  const body = (req as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== 'function') return req.text ? req.text() : '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The parsed body of `schema`, or `null` (wrong type, empty, over 1 KB, not JSON, not the strict schema). */
export async function jsonBodyOf<T>(req: PayloadRequest, schema: ZodType<T>): Promise<T | null> {
  if (!hasJsonContentType(req)) return null;
  // S07-02: a declared length over the limit (or malformed) is refused before reading; without a declared
  // length (the request may arrive re-wrapped by Next/Payload) the body is read as a stream and cut at the limit.
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  try {
    const text = await boundedText(req);
    if (text === null || text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null;
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
