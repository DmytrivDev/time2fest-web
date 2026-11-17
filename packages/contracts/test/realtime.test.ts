import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REALTIME_MAX_BATCH_EVENTS } from '../src/realtime';
import {
  RealtimeBatchSchema,
  RealtimeEnvelopeSchema,
  RealtimeTokenValueSchema,
  TestRealtimeTokenBodySchema,
} from '../src/realtime.schemas';
import { RealtimeTokenResponseSchema } from '../src/schemas';

const env = (id: string) => ({ type: 'chat.message', id });

describe('realtime wire schemas', () => {
  it('parses the C1 token response (configured and not configured)', () => {
    const ok = { ok: true, value: { token: 'a.b.c', expiresAt: '2027-01-01T00:00:00Z' } };
    const off = { ok: true, value: { token: null, expiresAt: null } };
    expect(RealtimeTokenResponseSchema.safeParse(ok).success).toBe(true);
    expect(RealtimeTokenResponseSchema.safeParse(off).success).toBe(true);
  });

  it('parses the C3 envelope and batch', () => {
    expect(RealtimeEnvelopeSchema.safeParse({ type: 'site.state', id: 'e1', version: 0, data: { a: 1 } }).success).toBe(true);
    expect(RealtimeBatchSchema.safeParse({ type: 'batch', id: 'b1', events: [env('e1')] }).success).toBe(true);
  });

  it('rejects an envelope without id or with a negative version', () => {
    expect(RealtimeEnvelopeSchema.safeParse({ type: 't' }).success).toBe(false);
    expect(RealtimeEnvelopeSchema.safeParse({ type: 't', id: 'x', version: -1 }).success).toBe(false);
  });

  it('rejects a batch without events and a batch over the limit', () => {
    expect(RealtimeBatchSchema.safeParse({ type: 'batch', id: 'b' }).success).toBe(false);
    const events = Array.from({ length: REALTIME_MAX_BATCH_EVENTS + 1 }, (_, i) => env(`e${i}`));
    expect(RealtimeBatchSchema.safeParse({ type: 'batch', id: 'b', events }).success).toBe(false);
    expect(RealtimeBatchSchema.safeParse({ type: 'batch', id: 'b', events: events.slice(0, 200) }).success).toBe(true);
  });

  it('rejects a token value where only one field is null', () => {
    expect(RealtimeTokenValueSchema.safeParse({ token: 'x', expiresAt: null }).success).toBe(false);
  });

  it('validates the test-door body', () => {
    expect(TestRealtimeTokenBodySchema.safeParse({ subject: { kind: 'guest', id: 'g_1' }, ttlSeconds: 4500 }).success).toBe(true);
    expect(TestRealtimeTokenBodySchema.safeParse({ subject: { kind: 'guest', id: 'a:b' } }).success).toBe(false);
    expect(TestRealtimeTokenBodySchema.safeParse({ subject: { kind: 'guest', id: 'g' }, ttlSeconds: 4501 }).success).toBe(false);
  });

  it('keeps the types file free of zod', () => {
    expect(readFileSync(new URL('../src/realtime.ts', import.meta.url), 'utf8')).not.toMatch(/from ['"]zod/);
  });
});
