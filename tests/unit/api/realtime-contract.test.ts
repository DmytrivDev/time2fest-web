/**
 * Contract suite of the realtime transport (SPEC-06): what a listener may rely on for the C3 shapes —
 * stale and repeated envelopes dropped per channel (AC-54), batches unpacked in order (AC-46).
 */
import { RealtimeBatchSchema, RealtimeEnvelopeSchema } from '@time2fest/contracts/schemas';
import type { RealtimeBatch, RealtimeEnvelope } from '@time2fest/contracts';
import { describe, expect, it } from 'vitest';
import { createChannelFilter, DEDUPE_ID_WINDOW } from '@/lib/api/http/realtime/dedupe';
import { envelopesOf } from '@/lib/api/http/realtime/transport';

function accepted(envelopes: RealtimeEnvelope[], filter = createChannelFilter()): RealtimeEnvelope[] {
  return envelopes.filter((e) => filter.accept(e));
}

const versioned = (version: number): RealtimeEnvelope => ({ type: 'site', id: `s${version}`, version });
const plain = (id: string): RealtimeEnvelope => ({ type: 'message', id });

describe('AC-54 — stale and repeated envelopes', () => {
  it('versions v3, v2, v4 → v3, v4 accepted', () => {
    expect(accepted([versioned(3), versioned(2), versioned(4)]).map((e) => e.version)).toEqual([3, 4]);
  });

  it('a version equal to the last accepted one is dropped; version 0 is accepted first', () => {
    expect(accepted([versioned(0), versioned(0), versioned(1)]).map((e) => e.version)).toEqual([0, 1]);
  });

  it('an envelope without version whose id was accepted before is dropped', () => {
    expect(accepted([plain('a'), plain('b'), plain('a')]).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it(`the window is ${DEDUPE_ID_WINDOW} ids: the 1 001st-oldest id is accepted again, the 1 000th is not`, () => {
    expect(DEDUPE_ID_WINDOW).toBe(1_000);
    const filter = createChannelFilter();
    const ids = Array.from({ length: DEDUPE_ID_WINDOW + 1 }, (_, i) => `id-${i}`);
    expect(accepted(ids.map(plain), filter)).toHaveLength(DEDUPE_ID_WINDOW + 1);
    // `id-0` is now the 1 001st-oldest, out of the window; `id-1` is the oldest one still inside.
    expect(filter.accept(plain('id-1'))).toBe(false);
    expect(filter.accept(plain('id-0'))).toBe(true);
  });

  it('every channel keeps its own memory', () => {
    const a = createChannelFilter();
    const b = createChannelFilter();
    expect(a.accept(versioned(5))).toBe(true);
    expect(b.accept(versioned(1))).toBe(true);
    expect(a.accept(plain('x'))).toBe(true);
    expect(b.accept(plain('x'))).toBe(true);
  });

  it('every example used here is a valid C3 envelope', () => {
    for (const e of [versioned(0), versioned(4), plain('a')]) {
      expect(RealtimeEnvelopeSchema.safeParse(e).success).toBe(true);
    }
  });
});

describe('AC-46 — a C3 batch is unpacked into its envelopes in array order', () => {
  const batch: RealtimeBatch = {
    type: 'batch',
    id: 'b-1',
    events: [
      { type: 'message', id: 'm1', data: { text: 'one' } },
      { type: 'message', id: 'm2', version: 7 },
      { type: 'message', id: 'm3' },
    ],
  };

  it('the batch is a valid C3 batch', () => {
    expect(RealtimeBatchSchema.safeParse(batch).success).toBe(true);
  });

  it('three envelopes, same order, same content', () => {
    expect(envelopesOf(batch)).toEqual(batch.events);
  });

  it('a single envelope is one event; anything else is none', () => {
    expect(envelopesOf(plain('solo'))).toEqual([plain('solo')]);
    expect(envelopesOf(null)).toEqual([]);
    expect(envelopesOf({ type: 'batch', id: 'b', events: 'x' })).toEqual([]);
  });

  it('unpacked envelopes then pass the channel filter one by one', () => {
    const filter = createChannelFilter();
    expect(accepted(envelopesOf(batch), filter).map((e) => e.id)).toEqual(['m1', 'm2', 'm3']);
    expect(accepted(envelopesOf(batch), filter)).toEqual([]);
  });
});
