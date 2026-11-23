import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { applyStreamEvent, parseChainsResponse, parseStreamEvent, parseViewerSummary, type ChainsResponse, type StreamChain, type StreamEvent } from '../src/index';
import {
  ChainsResponseSchema,
  LiveArchiveRowSchema,
  StreamEventSchema,
  ViewerSummarySchema,
} from '../src/schemas';

type Json = Record<string, unknown>;
const data = JSON.parse(readFileSync(new URL('../../../data/streams.json', import.meta.url), 'utf8')) as { chains: StreamChain[] };
const at = '2026-11-23T00:00:00Z';
const src = data.chains[0]!.sources[0]!;
const chain: StreamChain = { eventId: 'e1', sources: [src, { ...src, id: 's2', order: 1 }] };
const mapOf = (cs: StreamChain[]) => new Map(cs.map((c) => [c.eventId, c]));

describe('live schemas and guard agree', () => {
  it('every chain of data/streams.json passes schema and guard', () => {
    const body = { version: 1, at, chains: data.chains };
    expect(ChainsResponseSchema.safeParse(body).success).toBe(true);
    expect(parseChainsResponse(body)).not.toBeNull();
  });

  const bad = (s: unknown): Json => ({ type: 'source', eventId: 'e1', source: s, version: 1 });
  const cases: Array<[string, unknown]> = [
    ['not an object', 'x'],
    ['array', []],
    ['unknown type', { type: 'nope', version: 1 }],
    ['missing version', { type: 'hide', eventId: 'e1', sourceId: 's1' }],
    ['negative version', { type: 'hide', eventId: 'e1', sourceId: 's1', version: -1 }],
    ['fractional version', { type: 'hide', eventId: 'e1', sourceId: 's1', version: 1.5 }],
    ['empty sourceId', { type: 'hide', eventId: 'e1', sourceId: '', version: 1 }],
    ['extra key', { type: 'hide', eventId: 'e1', sourceId: 's1', version: 1, x: 1 }],
    ['source with bad status', bad({ ...src, status: 'soon' })],
    ['source with extra key', bad({ ...src, views: 5 })],
    ['source without url', bad({ ...src, url: undefined })],
    ['chain with bad source', { type: 'chain', chain: { eventId: 'e1', sources: [{ id: 1 }] }, version: 1 }],
  ];
  it.each(cases)('refuses %s identically', (_name, value) => {
    expect(StreamEventSchema.safeParse(value).success).toBe(false);
    expect(parseStreamEvent(value)).toBeNull();
  });

  it('accepts a valid event in both', () => {
    const ev: StreamEvent = { type: 'chain', chain, version: 3 };
    expect(StreamEventSchema.safeParse(ev).success).toBe(true);
    expect(parseStreamEvent(ev)).not.toBeNull();
  });

  it('viewer summary: people optional, same verdict', () => {
    for (const v of [{ countries: [], at }, { countries: [{ iso: 'UA', name: 'Ukraine', flagCode: 'ua' }], people: 5, at }]) {
      expect(ViewerSummarySchema.safeParse(v).success).toBe(true);
      expect(parseViewerSummary(v)).not.toBeNull();
    }
    const nope = { countries: [], people: -1, at };
    expect(ViewerSummarySchema.safeParse(nope).success).toBe(false);
    expect(parseViewerSummary(nope)).toBeNull();
  });
});

describe('applyStreamEvent', () => {
  const start = mapOf([chain]);
  it('drops an older version and returns the same map', () => {
    const r = applyStreamEvent(start, { type: 'hide', eventId: 'e1', sourceId: 's2', version: 2 }, 5);
    expect(r.chains).toBe(start);
    expect(r.version).toBe(5);
  });
  it('hide removes the source and advances the version', () => {
    const r = applyStreamEvent(start, { type: 'hide', eventId: 'e1', sourceId: 's2', version: 6 }, 5);
    expect(r.chains.get('e1')?.sources.map((s) => s.id)).toEqual([src.id]);
    expect(r.version).toBe(6);
  });
  it('unknown source or event leaves the map untouched', () => {
    expect(applyStreamEvent(start, { type: 'hide', eventId: 'e1', sourceId: 'zz', version: 6 }, 5).chains).toBe(start);
    expect(applyStreamEvent(start, { type: 'hide', eventId: 'zz', sourceId: 's2', version: 6 }, 5).chains).toBe(start);
  });
  it('source replaces by id, chain replaces whole', () => {
    const upd = { ...src, status: 'expected' as const };
    const a = applyStreamEvent(start, { type: 'source', eventId: 'e1', source: upd, version: 1 }, 0);
    expect(a.chains.get('e1')?.sources[0]?.status).toBe('expected');
    const b = applyStreamEvent(start, { type: 'chain', chain: { eventId: 'e2', sources: [] }, version: 1 }, 0);
    expect(b.chains.has('e2')).toBe(true);
  });
});

describe('live archive and sizes', () => {
  it('archive row has no YouTube field', () => {
    expect(Object.keys(LiveArchiveRowSchema.shape).sort()).toEqual(['decision', 'label', 'order', 'videoId']);
    expect(LiveArchiveRowSchema.safeParse({ videoId: 'v', label: 'l', order: 0, decision: 'kept', title: 'x' }).success).toBe(false);
  });
  const ten = (i: number): StreamChain => ({ eventId: `e${i}`, sources: Array.from({ length: 10 }, (_, k) => ({ ...src, id: `s${i}_${k}`, order: k })) });
  it('a chain event with 10 sources is at most 65536 bytes', () => {
    const ev: StreamEvent = { type: 'chain', chain: ten(1), version: 1 };
    expect(Buffer.byteLength(JSON.stringify(ev))).toBeLessThanOrEqual(65_536);
  });
  it('a response of 300 events x 10 sources is at most 524288 bytes on the wire (gzip, as the CDN serves it)', () => {
    // Deviation: raw JSON of 3000 full sources is ~1.28 MB (~426 B each), so the cap is checked on the compressed body.
    const body: ChainsResponse = { version: 1, at, chains: Array.from({ length: 300 }, (_, i) => ten(i)) };
    expect(gzipSync(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(524_288);
  });
});
