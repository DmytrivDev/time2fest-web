/** «Джерела» view (SPEC-21a AC-20, W28): pure props → markup, with data shaped as the fake-fed `GET /cms-api/streams/view`. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StreamsView, type StreamsViewValue } from '../../src/admin/StreamsView';
import { adminSlotRegistry, visibleSlots } from '../../src/registries/adminSlots';

const CH_WATCHED = 'UCaaaaaaaaaaaaaaaaaaaaa1';
const CH_PROPOSED = 'UCbbbbbbbbbbbbbbbbbbbbb2';
const CH_BLACK = 'UCccccccccccccccccccccc3';

const channel = (channelId: string, extra: Record<string, unknown> = {}) => ({
  channelId,
  name: `Канал ${channelId.slice(-1)}`,
  kind: 'tv',
  zones: ['utc+0000'],
  seasons: ['2026-27'],
  priority: 1,
  state: 'watched',
  blacklisted: false,
  blacklistReason: null,
  blacklistSource: null,
  proposedBy: null,
  uploadsPlaylistId: `UU${channelId.slice(2)}`,
  uploadsFetchedAt: '2026-12-30T10:00:00.000Z',
  lastPlaylistAt: null,
  lastSearchAt: null,
  ...extra,
});

const candidate = (videoId: string, extra: Record<string, unknown> = {}) => ({
  videoId,
  channelId: CH_WATCHED,
  channelName: 'Канал 1',
  foundBy: ['playlist'],
  state: 'new',
  reason: null,
  eventId: null,
  sourceId: null,
  scheduledStartTime: '2026-12-31T23:58:00.000Z',
  checkedAt: '2026-12-31T20:00:00.000Z',
  stateChangedAt: '2026-12-31T20:00:00.000Z',
  evidenceUrl: null,
  note: null,
  defaultEventId: null,
  fromBlacklisted: false,
  ...extra,
});

const view = {
  now: '2026-12-31T20:00:00.000Z',
  channels: [
    channel(CH_WATCHED),
    channel(CH_PROPOSED, { state: 'proposed', proposedBy: 'agent-1', priority: 2 }),
    channel(CH_BLACK, { blacklisted: true, blacklistReason: 'Чужий контент', priority: 3 }),
  ],
  candidates: [
    candidate('aaaaaaaaaa1', { state: 'proposed', foundBy: ['agent'], defaultEventId: 'ev-utc0', note: '<img src=x onerror=alert(1)>', evidenceUrl: 'https://example.org/post' }),
    candidate('bbbbbbbbbb2', { evidenceUrl: 'javascript:alert(1)' }),
    candidate('ccccccccccc', { state: 'rejected', reason: 'not-live' }),
    candidate('ddddddddddd', { state: 'approved', channelId: CH_BLACK, channelName: 'Канал 3', eventId: 'ev-utc1', fromBlacklisted: true }),
  ],
  next: '100',
  events: [
    { eventId: 'ev-utc1', zoneId: 'utc+0100', moment: '2026-12-31T23:00:00.000Z' },
    { eventId: 'ev-utc0', zoneId: 'utc+0000', moment: '2027-01-01T00:00:00.000Z' },
  ],
  quota: [
    { cls: 'candidates', used: 30, limit: 300, percent: 10, resetAt: '2027-01-01T07:00:00.000Z' },
    { cls: 'playlists', used: 0, limit: 1000, percent: 0, resetAt: '2027-01-01T07:00:00.000Z' },
    { cls: 'search', used: 2, limit: 100, percent: 2, resetAt: '2027-01-01T07:00:00.000Z' },
  ],
} as unknown as StreamsViewValue;

const html = () => renderToStaticMarkup(createElement(StreamsView, { view, filter: { state: 'proposed' } }));
const rowOf = (out: string, testId: string) => {
  const start = out.indexOf(`data-testid="${testId}"`);
  return out.slice(start, out.indexOf('</tr>', start));
};

describe('StreamsView', () => {
  it('shows every channel column and its actions: blacklist toggle, edit, approve for a proposed channel', () => {
    const out = html();
    for (const h of ['Назва', 'channelId', 'Тип', 'Пояси', 'Пріоритет', 'Стан', 'Чорний список', 'Дії']) expect(out).toContain(`<th>${h}</th>`);
    const watched = rowOf(out, `streams-channel-${CH_WATCHED}`);
    expect(watched).toContain('ТБ');
    expect(watched).toContain('utc+0000');
    expect(watched).toContain('стежимо');
    expect(watched).toContain('У чорний список');
    expect(watched).toContain(`streams-edit-${CH_WATCHED}`);
    expect(watched).not.toContain('streams-channel-approve-');
    expect(rowOf(out, `streams-channel-${CH_PROPOSED}`)).toContain(`streams-channel-approve-${CH_PROPOSED}`);
    const black = rowOf(out, `streams-channel-${CH_BLACK}`);
    expect(black).toContain('у чорному списку: Чужий контент');
    expect(black).toContain('Зняти з чорного списку');
  });

  it('shows the candidate queue with filters, per-state actions and the blacklisted-approved marker', () => {
    const out = html();
    for (const h of ['Відео', 'Канал', 'Звідки', 'Причина', 'Подія', 'Початок', 'Перевірено', 'Нотатка агента']) expect(out).toContain(`<th>${h}</th>`);
    expect(out).toContain('data-testid="streams-filter-state"');
    expect(out).toContain('data-testid="streams-filter-event"');
    expect(out).toMatch(/<option value="proposed" selected="">запропоновано<\/option>/);
    const proposed = rowOf(out, 'streams-candidate-aaaaaaaaaa1');
    expect(proposed).toContain('streams-approve-aaaaaaaaaa1');
    expect(proposed).toContain('streams-reject-aaaaaaaaaa1');
    expect(proposed).not.toContain('streams-requeue-');
    const rejected = rowOf(out, 'streams-candidate-ccccccccccc');
    expect(rejected).toContain('не трансляція');
    expect(rejected).toContain('streams-requeue-ccccccccccc');
    expect(rejected).not.toContain('streams-approve-');
    expect(rowOf(out, 'streams-candidate-ddddddddddd')).toContain('streams-from-blacklisted-ddddddddddd');
    expect(out).toContain('data-testid="streams-next"');
  });

  it('preselects the default event in the approve form and offers every season event', () => {
    const approve = rowOf(html(), 'streams-candidate-aaaaaaaaaa1');
    expect(approve).toMatch(/<option value="ev-utc0" selected="">ev-utc0 · utc\+0000 · [^<]*\(за замовчуванням\)<\/option>/);
    expect(approve).toContain('<option value="ev-utc1">');
    const plain = rowOf(html(), 'streams-candidate-bbbbbbbbbb2');
    expect(plain).toMatch(/<option value="" selected="">без події<\/option>/);
  });

  it('renders the agent note as text, links YouTube without referrer and the evidence only when https', () => {
    const out = html();
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('href="https://www.youtube.com/watch?v=aaaaaaaaaa1" target="_blank" rel="noopener noreferrer nofollow"');
    expect(out).toContain(`href="https://www.youtube.com/channel/${CH_WATCHED}" target="_blank" rel="noopener noreferrer nofollow"`);
    expect(out).toContain('data-testid="streams-evidence-aaaaaaaaaa1"');
    expect(out).toContain('href="https://example.org/post"');
    expect(out).not.toContain('streams-evidence-bbbbbbbbbb2');
    expect(out).not.toContain('javascript:');
  });

  it('shows the add forms and the three quota lines', () => {
    const out = html();
    expect(out).toContain('data-testid="streams-channel-add"');
    expect(out).toContain('data-testid="streams-candidate-add"');
    expect(out).toContain('Додати за videoId чи channelId');
    expect(out.match(/data-testid="streams-quota-/g)).toHaveLength(3);
    expect(out).toContain('Перевірка кандидатів: 30 / 300 (10%)');
    expect(out).toContain('Пошук: 2 / 100 (2%)');
  });

  it('lists the slot 17-streams «Джерела» between the live air and the unattended mode in every class', () => {
    const row = adminSlotRegistry.find((r) => r.key === '17-streams');
    expect(row).toMatchObject({ order: 17, label: 'Джерела' });
    const keys = visibleSlots('production').map((s) => s.key);
    expect(keys.indexOf('17-streams')).toBe(keys.indexOf('15-live') + 1);
    expect(keys.indexOf('20-unattended')).toBe(keys.indexOf('17-streams') + 1);
  });
});
