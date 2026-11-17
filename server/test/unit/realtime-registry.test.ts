import { describe, expect, it } from 'vitest';
import { channelName, type ChannelClassRow } from '../../src/domain/realtime/channels';
import { channelClassesFor, channelRegistry, REALTIME_SITE_ORIGINS } from '../../src/registries/channels';

/** C8 of SPEC-06, literally: key · namespace · visibility · history size / TTL · batched · test only. */
const C8: readonly [string, string | null, 'public' | 'personal', number, number, boolean, boolean][] = [
  ['chat:country', 'chat', 'public', 100, 300, true, false],
  ['chat:world', 'chat', 'public', 100, 300, true, false],
  ['live:streams', 'live', 'public', 10, 300, false, false],
  ['live:viewers', 'live', 'public', 1, 120, false, false],
  ['notif', 'notif', 'personal', 20, 600, false, false],
  ['orders', 'orders', 'personal', 20, 600, false, false],
  ['rating', null, 'public', 20, 300, false, false],
  ['rttest', 'rttest', 'public', 50, 120, true, true],
  ['site:state', 'site', 'public', 10, 300, false, false],
  ['toasts', null, 'public', 20, 300, false, false],
  ['user', 'user', 'personal', 20, 600, false, false],
];

function row(key: string): ChannelClassRow {
  const r = channelRegistry.find((c) => c.key === key);
  if (r === undefined) throw new Error(`no row ${key}`);
  return r;
}

/** class key · key · name with prefix `abc_` · name with `''` (AC-10, seam §2.6). */
const NAMES: readonly [string, string | undefined, string, string][] = [
  ['chat:country', 'UA', 'chat:abc_country.UA', 'chat:country.UA'],
  ['chat:world', undefined, 'chat:abc_world', 'chat:world'],
  ['live:streams', undefined, 'live:abc_streams', 'live:streams'],
  ['live:viewers', undefined, 'live:abc_viewers', 'live:viewers'],
  ['notif', '42', 'notif:abc_user#42', 'notif:user#42'],
  ['orders', '42', 'orders:abc_user#42', 'orders:user#42'],
  ['rating', undefined, 'abc_rating', 'rating'],
  ['rttest', 'batch', 'rttest:abc_batch', 'rttest:batch'],
  ['site:state', undefined, 'site:abc_state', 'site:state'],
  ['toasts', undefined, 'abc_toasts', 'toasts'],
  ['user', '42', 'user:abc_#42', 'user:#42'],
];

describe('channel registry (SPEC-06 C8)', () => {
  it('AC-1: holds exactly the C8 classes with their visibility, history and batching', () => {
    expect(
      channelRegistry.map((r) => [r.key, r.namespace, r.visibility, r.history.size, r.history.ttlSeconds, r.batched, r.testOnly === true]),
    ).toEqual(C8);
    expect(channelRegistry).toHaveLength(11);
  });

  it('AC-1: rttest exists only in the test class', () => {
    expect(channelClassesFor('test').map((r) => r.key)).toContain('rttest');
    for (const cls of ['rehearsal', 'production'] as const) {
      const keys = channelClassesFor(cls).map((r) => r.key);
      expect(keys).not.toContain('rttest');
      expect(keys).toHaveLength(10);
    }
  });

  it('site origins per class come from the edge worker routes', () => {
    expect(REALTIME_SITE_ORIGINS).toEqual({ rehearsal: 'https://rehearsal.time2fest.com', production: 'https://time2fest.com' });
  });
});

describe('channel names (SPEC-06 AC-10)', () => {
  it.each(NAMES)('%s / %s → %s with prefix abc_, %s without', (cls, key, prefixed, plain) => {
    expect(channelName(row(cls), key, 'abc_')).toBe(prefixed);
    expect(channelName(row(cls), key, '')).toBe(plain);
  });

  it('covers every row of the registry', () => {
    expect(NAMES.map(([cls]) => cls)).toEqual(channelRegistry.map((r) => r.key));
  });

  it('a key with `:`, `#` or `,` is refused (undefined, no throw)', () => {
    for (const bad of ['U:A', 'U#', 'U,A']) expect(channelName(row('chat:country'), bad, '')).toBeUndefined();
    for (const bad of ['4:2', '4#2', '4,2']) {
      expect(channelName(row('user'), bad, 'abc_')).toBeUndefined();
      expect(channelName(row('notif'), bad, 'abc_')).toBeUndefined();
    }
    for (const bad of ['a:b', 'a#b', 'a,b']) expect(channelName(row('rttest'), bad, 'abc_')).toBeUndefined();
  });

  it('AC-18: a personal key must be 1–64 of [A-Za-z0-9_-]', () => {
    expect(channelName(row('user'), 'a'.repeat(64), '')).toBe(`user:#${'a'.repeat(64)}`);
    expect(channelName(row('user'), 'a'.repeat(65), '')).toBeUndefined();
    expect(channelName(row('user'), '', '')).toBeUndefined();
    expect(channelName(row('user'), 'ab c', '')).toBeUndefined();
  });

  it('refuses a lower-case or long ISO key, a missing key, a key on a fixed channel and a malformed prefix', () => {
    expect(channelName(row('chat:country'), 'ua', '')).toBeUndefined();
    expect(channelName(row('chat:country'), 'UKR', '')).toBeUndefined();
    expect(channelName(row('chat:country'), undefined, '')).toBeUndefined();
    expect(channelName(row('user'), undefined, '')).toBeUndefined();
    expect(channelName(row('toasts'), 'x', '')).toBeUndefined();
    expect(channelName(row('toasts'), undefined, 'ABC_')).toBeUndefined();
    expect(channelName(row('toasts'), undefined, 'a:b_')).toBeUndefined();
  });
});
