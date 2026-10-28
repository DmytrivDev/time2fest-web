import { describe, expect, it } from 'vitest';
import chatScript from '@/data/chat-script.json';
import type { ChatScriptFile } from '@/lib/data/types';
import { data } from '@/lib/data/load';
import {
  buildMomentContexts,
  ambientBetween,
  createChatSimulator,
  messageId,
  messagesBetween,
  momentMessages,
  type MomentContext,
} from '@/lib/chat-sim/simulator';
import { useChatFeed } from '@/lib/chat-sim/store';

const script = chatScript as unknown as ChatScriptFile;
const T0 = Date.parse('2027-01-01T00:00:00Z');
const SEC = 1_000;

const london: MomentContext = {
  t0: T0,
  eventId: 'evt_london_2027',
  cityId: 'london',
  countries: [{ iso: 'GB', gender: 'f' }],
  eventIds: ['evt_london_2027'],
};

describe('buildMomentContexts', () => {
  it('подія слота — та, що в ефірі (Лондон для UTC+0), з родом країни', () => {
    const m = buildMomentContexts(data).find((x) => x.t0 === T0);
    expect(m).toMatchObject({ eventId: 'evt_london_2027', countries: [{ iso: 'GB', gender: 'f' }], eventIds: ['evt_london_2027'] });
  });

  it('слоти за зростанням півночі, з Кірибаті', () => {
    const all = buildMomentContexts(data);
    expect(all.length).toBeGreaterThan(30);
    expect(all.map((m) => m.t0)).toEqual([...all.map((m) => m.t0)].sort((a, b) => a - b));
  });
});

describe('momentMessages', () => {
  const world = momentMessages(script, london, 'world');

  it('«+15 с»: системне country-midnight із заповненими країною й подією', () => {
    const sys = world.find((m) => m.kind === 'system' && m.system?.kind === 'country-midnight');
    expect(sys).toBeDefined();
    expect(sys!.createdAt).toBe(T0 + 15 * SEC);
    expect(sys!.text).toBeUndefined();
    expect(sys!.author).toBeUndefined();
    expect(sys!.system).toEqual({ kind: 'country-midnight', countries: [{ iso: 'GB', gender: 'f' }], eventIds: ['evt_london_2027'] });
    expect(sys!.moderation).toBe('ok');
  });

  it('«+15 с»: привітання «Першого ряду» по одному на зайняте місце, у порядку місць', () => {
    const greetings = world.filter((m) => m.kind === 'greeting');
    expect(greetings).toHaveLength(9); // місце 10 вільне
    expect(greetings.every((g) => g.createdAt === T0 + 15 * SEC)).toBe(true);
    expect(greetings.map((g) => g.greeting!.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(greetings[0]!.greeting).toEqual({
      eventId: 'evt_london_2027',
      seat: 1,
      participantName: 'Олена і друзі',
      flagCode: 'UA',
      emojiId: 'glasses',
      cityId: 'london',
      text: 'Зустрічаємо разом!',
    });
  });

  it('системне повідомлення стоїть перед привітаннями того самого моменту', () => {
    const at15 = world.filter((m) => m.createdAt === T0 + 15 * SEC);
    expect(at15[0]!.kind).toBe('system');
  });

  it('«+16 с»: greetings-counter з eventId події', () => {
    const counter = world.find((m) => m.system?.kind === 'greetings-counter');
    expect(counter?.createdAt).toBe(T0 + 16 * SEC);
    expect(counter?.system).toMatchObject({ kind: 'greetings-counter', eventId: 'evt_london_2027' });
  });

  it('кімната країни отримує лише country-midnight (world+country), без привітань', () => {
    const gb = momentMessages(script, london, 'country:GB');
    expect(gb.map((m) => m.kind)).toEqual(['system']);
    expect(gb[0]!.room).toBe('country:GB');
  });

  it('звичайні репліки мають автора й текст до 200 символів', () => {
    const regular = world.filter((m) => m.kind === 'regular');
    expect(regular.length).toBeGreaterThan(0);
    for (const r of regular) {
      expect(r.author?.nick).toBeTruthy();
      expect(r.text!.length).toBeGreaterThan(0);
      expect(r.text!.length).toBeLessThanOrEqual(200);
    }
  });

  it('id — 26 символів Crockford, унікальні й сталі', () => {
    const ids = world.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(momentMessages(script, london, 'world').map((m) => m.id)).toEqual(ids);
    expect(messageId(T0, 1, 2, 'world')).not.toBe(messageId(T0, 1, 2, 'country:GB'));
  });

  it('подія без сіду «Першого ряду» — без привітань', () => {
    const azores = { ...london, t0: T0 + 3_600_000, eventId: 'evt_azores_2027', cityId: 'azores' };
    expect(momentMessages(script, azores, 'world').some((m) => m.kind === 'greeting')).toBe(false);
  });
});

describe('createChatSimulator', () => {
  const moments = buildMomentContexts(data);

  it('тікає від переданого часу: до «+15 с» системного немає, на «+15 с» — є', () => {
    const sim = createChatSimulator({ script, moments, rooms: ['world'], backfillMs: 0 });
    sim.advance(T0 + 14 * SEC);
    const before = sim.advance(T0 + 14 * SEC + 999);
    expect(before.some((m) => m.kind === 'system')).toBe(false);
    const at = sim.advance(T0 + 15 * SEC);
    expect(at.some((m) => m.system?.kind === 'country-midnight')).toBe(true);
    expect(at.filter((m) => m.kind === 'greeting')).toHaveLength(9);
  });

  it('перший виклик показує недавні повідомлення (backfill)', () => {
    const sim = createChatSimulator({ script, moments, rooms: ['world'] });
    const first = sim.advance(T0 + 60 * SEC);
    expect(first.some((m) => m.system?.kind === 'country-midnight')).toBe(true);
  });

  it('перемотка назад нічого не повторює', () => {
    const sim = createChatSimulator({ script, moments, rooms: ['world'], backfillMs: 0 });
    sim.advance(T0);
    expect(sim.advance(T0 + 20 * SEC).length).toBeGreaterThan(0);
    expect(sim.advance(T0 + 5 * SEC)).toEqual([]);
  });

  it('великий стрибок — не більше maxBatch найновіших', () => {
    const sim = createChatSimulator({ script, moments, rooms: ['world'], backfillMs: 0, maxBatch: 5 });
    sim.advance(T0 - 3_600_000);
    const batch = sim.advance(T0 + 3_600_000);
    expect(batch).toHaveLength(5);
  });

  it('messagesBetween не повертає повідомлень поза вікном', () => {
    const out = messagesBetween(script, moments, ['world'], T0 + 15 * SEC, T0 + 16 * SEC);
    expect(out.every((m) => m.createdAt > T0 + 15 * SEC && m.createdAt <= T0 + 16 * SEC)).toBe(true);
  });
});

describe('useChatFeed', () => {
  it('дописує без дублів і в порядку (createdAt, id)', () => {
    useChatFeed.getState().reset();
    const msgs = momentMessages(script, london, 'world');
    useChatFeed.getState().append(msgs.slice(3));
    useChatFeed.getState().append(msgs);
    const room = useChatFeed.getState().rooms.world!;
    expect(room.map((m) => m.id)).toEqual(msgs.map((m) => m.id));
  });
});

describe('ambientBetween', () => {
  it('однакова репліка не йде поспіль (кімната країни біля півночі)', () => {
    const msgs = ambientBetween(script, [london], ['country:GB'], T0 - 120 * SEC, T0 + 120 * SEC).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    expect(msgs.length).toBeGreaterThan(20);
    for (let i = 1; i < msgs.length; i++) expect(msgs[i]!.text).not.toBe(msgs[i - 1]!.text);
    expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length);
  });
});
