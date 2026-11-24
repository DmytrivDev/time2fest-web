/** Stream sources wire schemas (SPEC-21a AC-14, AC-33, AC-39 schema half; door variants of AC-44). */
import { describe, expect, it } from 'vitest';
import { STREAMS_BODY_MAX_BYTES, streamsBodyWithinLimit } from '../src/index';
import {
  AgentCandidatesQuerySchema,
  AgentCandidatesResponseSchema,
  AgentChannelsResponseSchema,
  AgentProposeBodySchema,
  AgentProposeResultSchema,
  ChannelIdSchema,
  LiveDoorBodySchema,
  StreamChannelsFileSchema,
  StreamsActionBodySchema,
  VideoIdSchema,
} from '../src/schemas';

const VID = 'dQw4w9WgXcQ';
const CH = 'UC' + 'abcdefghij_-ABCDEFGHIJ';
const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => s.safeParse(v).success;

describe('ids (AC-14)', () => {
  it('videoId: 11 URL-safe characters only', () => {
    expect(ok(VideoIdSchema, VID)).toBe(true);
    expect(ok(VideoIdSchema, 'a-b_c1234XY')).toBe(true);
    for (const bad of ['', 'dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9WgXc!', 'dQw4w9 gXcQ', `${VID}\n`]) expect(ok(VideoIdSchema, bad), bad).toBe(false);
  });
  it('channelId: UC + 22 URL-safe characters; no handle, no URL', () => {
    expect(ok(ChannelIdSchema, CH)).toBe(true);
    for (const bad of ['@bbcnews', 'UC' + 'a'.repeat(21), 'UC' + 'a'.repeat(23), 'UU' + 'a'.repeat(22), 'UC' + 'a'.repeat(21) + '.', `https://www.youtube.com/channel/${CH}`]) {
      expect(ok(ChannelIdSchema, bad), bad).toBe(false);
    }
  });
});

describe('agent propose body (AC-33)', () => {
  it('accepts a videoId or a channelId with the optional extras', () => {
    expect(ok(AgentProposeBodySchema, { videoId: VID })).toBe(true);
    expect(ok(AgentProposeBodySchema, { channelId: CH })).toBe(true);
    expect(ok(AgentProposeBodySchema, { videoId: VID, eventId: 'evt_1', evidenceUrl: 'https://example.org/a', note: 'x'.repeat(300) })).toBe(true);
    expect(ok(AgentProposeBodySchema, { videoId: VID, evidenceUrl: 'https://example.org/' + 'a'.repeat(480) })).toBe(true);
    // ordinary long slugs and ids are not secret-shaped
    expect(ok(AgentProposeBodySchema, { videoId: VID, evidenceUrl: 'https://example.org/new-year-eve-2026-live-broadcast-from-kyiv-main-square', note: 'UCabcdefghij_-ABCDEFGHIJ channel' })).toBe(true);
  });
  const bad: Array<[string, unknown]> = [
    ['extra field', { videoId: VID, title: 'x' }],
    ['both ids', { videoId: VID, channelId: CH }],
    ['neither id', { eventId: 'evt_1' }],
    ['http evidence', { videoId: VID, evidenceUrl: 'http://example.org/a' }],
    ['javascript evidence', { videoId: VID, evidenceUrl: 'javascript:alert(1)' }],
    ['evidence 501 chars', { videoId: VID, evidenceUrl: 'https://example.org/' + 'a'.repeat(481) }],
    ['note 301 chars', { videoId: VID, note: 'x'.repeat(301) }],
    ['bad videoId', { videoId: 'short' }],
    ['handle as channel', { channelId: '@bbcnews' }],
    ['event id with a space', { videoId: VID, eventId: 'evt 1' }],
    // S21-02: a secret-shaped token in note / evidence (an agent key is 43 base64url chars; Access ids are hex).
    ['agent key in note', { videoId: VID, note: 'Kq3vZ8xY_2mN-pL7rT1wB9cD4eF6gH0jA5sU8iO2kLm' }],
    ['agent key in evidence', { videoId: VID, evidenceUrl: 'https://evil.example/?k=Kq3vZ8xY_2mN-pL7rT1wB9cD4eF6gH0jA5sU8iO2kLm' }],
    ['hex secret in note', { channelId: CH, note: 'see 3f9a1c0b7e2d4f6a8b1c3e5d7f9a0b2c4d6e8f1a3b5c7d9e0f2a4b6c8d0e1f2a' }],
  ];
  it.each(bad)('refuses %s', (_name, body) => {
    expect(ok(AgentProposeBodySchema, body)).toBe(false);
  });
  it('a body of 1 025 bytes is over the limit, 1 024 is within', () => {
    expect(streamsBodyWithinLimit('x'.repeat(STREAMS_BODY_MAX_BYTES))).toBe(true);
    expect(streamsBodyWithinLimit('x'.repeat(STREAMS_BODY_MAX_BYTES + 1))).toBe(false);
    // Bytes, not characters: 300 Cyrillic letters of a note are 600 bytes.
    expect(streamsBodyWithinLimit(JSON.stringify({ videoId: VID, note: 'ї'.repeat(300), evidenceUrl: 'https://example.org/' + 'a'.repeat(480) }))).toBe(false);
  });
  it('result: candidate and channel shapes', () => {
    expect(ok(AgentProposeResultSchema, { videoId: VID, state: 'proposed', created: true })).toBe(true);
    expect(ok(AgentProposeResultSchema, { videoId: VID, state: 'rejected', reason: 'blacklisted', created: false })).toBe(true);
    expect(ok(AgentProposeResultSchema, { channelId: CH, state: 'proposed', created: true, added: 2 })).toBe(true);
    expect(ok(AgentProposeResultSchema, { videoId: VID, state: 'live', created: true })).toBe(false);
  });
});

describe('agent reads (AC-33)', () => {
  it('channels and blacklist', () => {
    const value = { channels: [{ channelId: CH, name: 'TV', type: 'tv', zones: ['utc+0200'], seasons: ['2026-27'], priority: 1, state: 'watched' }], blacklist: [CH] };
    expect(ok(AgentChannelsResponseSchema, value)).toBe(true);
    expect(ok(AgentChannelsResponseSchema, { ...value, channels: [{ ...value.channels[0], priority: 4 }] })).toBe(false);
    expect(ok(AgentChannelsResponseSchema, { ...value, evidence: [] })).toBe(false);
  });
  it('candidates query and page of at most 100', () => {
    expect(ok(AgentCandidatesQuerySchema, {})).toBe(true);
    expect(ok(AgentCandidatesQuerySchema, { state: 'proposed', eventId: 'evt_1', cursor: 'abc' })).toBe(true);
    expect(ok(AgentCandidatesQuerySchema, { state: 'pending' })).toBe(false);
    expect(ok(AgentCandidatesQuerySchema, { limit: 5 })).toBe(false);
    const item = { videoId: VID, channelId: CH, foundBy: ['agent', 'playlist'], state: 'new' };
    expect(ok(AgentCandidatesResponseSchema, { items: Array(100).fill(item), next: 'n1' })).toBe(true);
    expect(ok(AgentCandidatesResponseSchema, { items: Array(101).fill(item) })).toBe(false);
    expect(ok(AgentCandidatesResponseSchema, { items: [{ videoId: VID, foundBy: ['owner'], state: 'new' }] })).toBe(true);
    expect(ok(AgentCandidatesResponseSchema, { items: [{ ...item, title: 'x' }] })).toBe(false);
  });
});

describe('owner slice actions', () => {
  const good: unknown[] = [
    { action: 'channel-add', channelId: CH, name: 'TV', kind: 'tv', zones: ['utc+0200'], priority: 1 },
    { action: 'channel-edit', channelId: CH, priority: 2 },
    { action: 'channel-edit', channelId: CH, state: 'off' },
    { action: 'blacklist', channelId: CH, reason: 'fake' },
    { action: 'unblacklist', channelId: CH, reason: 'mistake' },
    { action: 'channel-approve', channelId: CH },
    { action: 'candidate-add', videoId: VID },
    { action: 'candidate-add', channelId: CH, eventId: 'evt_1' },
    { action: 'approve', videoId: VID, eventId: 'evt_1' },
    { action: 'reject', videoId: VID, reason: 're-upload' },
    { action: 'requeue', videoId: VID },
  ];
  it.each(good.map((b) => [(b as { action: string }).action, b]))('accepts %s', (_a, body) => {
    expect(ok(StreamsActionBodySchema, body)).toBe(true);
  });
  const bad: unknown[] = [
    { action: 'candidate-add', videoId: VID, channelId: CH },
    { action: 'candidate-add' },
    { action: 'channel-edit', channelId: CH, state: 'proposed' },
    { action: 'channel-add', channelId: CH, name: 'TV', kind: 'radio', zones: [], priority: 1 },
    { action: 'blacklist', channelId: CH, reason: '' },
    { action: 'reject', videoId: VID },
    { action: 'approve', videoId: VID },
    { action: 'requeue', videoId: VID, x: 1 },
    { action: 'publish', videoId: VID },
  ];
  it.each(bad.map((b, i) => [i, b]))('refuses case %i', (_i, body) => {
    expect(ok(StreamsActionBodySchema, body)).toBe(false);
  });
});

describe('input file data/stream-channels.json (AC-39 schema)', () => {
  const file = {
    version: 1,
    season: '2026-27',
    channels: [{ channelId: CH, name: 'TV', kind: 'irl', zones: ['utc+0000'], priority: 3 }],
    blacklist: [{ channelId: CH, reason: 'fake stream' }],
  };
  it('parses a minimal file', () => {
    expect(ok(StreamChannelsFileSchema, file)).toBe(true);
  });
  it('refuses evidence and summary keys', () => {
    expect(ok(StreamChannelsFileSchema, { ...file, channels: [{ ...file.channels[0], evidence: 'https://youtube.com/watch?v=x' }] })).toBe(false);
    expect(ok(StreamChannelsFileSchema, { ...file, channels: [{ ...file.channels[0], summary: 'x' }] })).toBe(false);
    expect(ok(StreamChannelsFileSchema, { ...file, evidence: [] })).toBe(false);
  });
});

describe('live door variants (AC-44)', () => {
  it('channels, search-results and quota with a bucket parse', () => {
    expect(ok(LiveDoorBodySchema, { door: 'channels', channels: [{ id: CH, uploads: 'UU' + 'a'.repeat(22), videos: [VID] }, { id: CH, deleted: true }] })).toBe(true);
    expect(ok(LiveDoorBodySchema, { door: 'search-results', channelId: CH, ids: [VID, VID] })).toBe(true);
    expect(ok(LiveDoorBodySchema, { door: 'search-results', channelId: CH, ids: [] })).toBe(true);
    for (const bucket of ['queries', 'search', 'candidates', 'playlists']) expect(ok(LiveDoorBodySchema, { door: 'quota', used: 3, bucket })).toBe(true);
    expect(ok(LiveDoorBodySchema, { door: 'quota', used: 3 })).toBe(true);
  });
  it('refuses bad variants', () => {
    expect(ok(LiveDoorBodySchema, { door: 'quota', used: 3, bucket: 'ad-hoc' })).toBe(false);
    expect(ok(LiveDoorBodySchema, { door: 'channels', channels: [] })).toBe(false);
    expect(ok(LiveDoorBodySchema, { door: 'channels', channels: [{ id: CH, deleted: false }] })).toBe(false);
    expect(ok(LiveDoorBodySchema, { door: 'search-results', channelId: '@x', ids: [] })).toBe(false);
    expect(ok(LiveDoorBodySchema, { door: 'search-results', channelId: CH, ids: ['bad'] })).toBe(false);
  });
});
