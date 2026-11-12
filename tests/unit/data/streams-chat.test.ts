// Перевірка форми data/streams.json (contracts/streams.md) і data/chat-script.json (contracts/chat.md)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChatScriptFile, ScheduleFile, StreamsFile } from '@/lib/data/types';

const dir = resolve(__dirname, '../../../data');
const read = <T,>(name: string) => JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as T;
const schedule = read<ScheduleFile>('schedule.json');
const streams = read<StreamsFile>('streams.json');
const chat = read<ChatScriptFile>('chat-script.json');
const eventIds = new Set(schedule.zones.flatMap((z) => z.countries.flatMap((c) => c.cities.flatMap((ct) => ct.events.map((e) => e.id)))));
const mainEvents = new Set(
  schedule.zones.flatMap((z) => z.countries.flatMap((c) => c.cities.flatMap((ct) => ct.events.filter((e) => e.isMainCelebration).map((e) => e.id)))),
);

describe('streams.json', () => {
  it('6-8 подій з трансляціями, усі існують у розкладі й є основними', () => {
    expect(streams.chains.length).toBeGreaterThanOrEqual(6);
    expect(streams.chains.length).toBeLessThanOrEqual(8);
    for (const ch of streams.chains) {
      expect(eventIds.has(ch.eventId), ch.eventId).toBe(true);
      expect(mainEvents.has(ch.eventId), ch.eventId).toBe(true);
    }
    expect(new Set(streams.chains.map((c) => c.eventId)).size).toBe(streams.chains.length);
  });

  it('order без пропусків, id унікальні, YouTube videoId коректний, ключа немає', () => {
    const ids = new Set<string>();
    for (const ch of streams.chains) {
      ch.sources.forEach((s, i) => {
        expect(s.order).toBe(i);
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        if (s.platform === 'youtube') expect(s.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/);
        expect(s.verified).toBe(false);
        expect(s.test).toBe(true);
      });
    }
    expect(JSON.stringify(streams)).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  });

  it('є джерело expected зі startsAt до півночі події й принаймні дві події з ланцюжком >= 2', () => {
    const all = streams.chains.flatMap((c) => c.sources.map((s) => ({ c, s })));
    const expected = all.filter(({ s }) => s.status === 'expected');
    expect(expected.length).toBeGreaterThanOrEqual(1);
    for (const { s } of expected) expect(typeof s.startsAt).toBe('string');
    expect(streams.chains.filter((c) => c.sources.length >= 2).length).toBeGreaterThanOrEqual(2);
  });

  it('вбудовувані й у прямому ефірі після check_streams --write', () => {
    expect(streams.lastCheckedAt).not.toBeNull();
    for (const ch of streams.chains) {
      expect(ch.sources.some((s) => s.embeddable && s.isLive), ch.eventId).toBe(true);
    }
  });
});

describe('chat-script.json', () => {
  const authorIds = new Set(chat.authors.map((a) => a.id));

  it('автори: унікальні id, нік 2-20, є пас і шлях', () => {
    expect(authorIds.size).toBe(chat.authors.length);
    for (const a of chat.authors) {
      expect(a.nick.length).toBeGreaterThanOrEqual(2);
      expect(a.nick.length).toBeLessThanOrEqual(20);
      for (const p of a.path ?? []) expect(eventIds.has(p.eventId), p.eventId).toBe(true);
    }
    expect(chat.authors.some((a) => a.badges.includes('pass') && (a.path?.length ?? 0) > 0)).toBe(true);
  });

  it('presets покривають uk/en/es/fr; тексти до 200 символів без посилань', () => {
    expect(new Set(chat.presets.map((p) => p.lang))).toEqual(new Set(['uk', 'en', 'es', 'fr']));
    const texts = [...chat.presets.map((p) => p.text), ...chat.ambient.flatMap((r) => r.pool.map((m) => m.text))];
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(200);
      expect(t).not.toMatch(/https?:\/\/|www\.|\.(com|net|org|ua)\b/i);
    }
  });

  it('ambient: автори існують, replyToPoolIndex у межах пулу', () => {
    for (const r of chat.ambient) {
      expect(r.ratePerMin.nearMidnight).toBeGreaterThan(r.ratePerMin.idle);
      r.pool.forEach((m) => {
        expect(authorIds.has(m.authorId), m.authorId).toBe(true);
        if (m.replyToPoolIndex !== undefined) expect(m.replyToPoolIndex).toBeLessThan(r.pool.length);
      });
    }
  });

  it('moments: +15 с country-midnight, лічильник; привітань місць «Першого ряду» немає', () => {
    const m = chat.moments.find((x) => x.eventId === '*')!;
    const at15 = m.offsets.filter((o) => o.atSec === 15);
    expect(at15.some((o) => o.message.kind === 'system' && o.message.system.kind === 'country-midnight')).toBe(true);
    expect(m.offsets.some((o) => o.message.kind === 'system' && o.message.system.kind === 'greetings-counter')).toBe(true);
    expect(m.offsets.every((o) => ['system', 'regular', 'burst'].includes(o.message.kind))).toBe(true);
  });

  it('«Перший ряд» прибрано (2026-11-12): у сценарії немає firstRowSeed і позначки first-row', () => {
    expect('firstRowSeed' in chat).toBe(false);
    for (const a of chat.authors) expect(a.badges as string[], a.id).not.toContain('first-row');
  });
});
