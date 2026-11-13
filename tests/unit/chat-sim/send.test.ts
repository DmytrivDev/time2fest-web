import { describe, expect, it } from 'vitest';
import chatScript from '@/data/chat-script.json';
import type { ChatScriptFile } from '@/lib/data/types';
import { validateNick } from '@/lib/chat/nick';
import {
  excerptOf,
  hasLink,
  MAX_TEXT,
  sendMessage,
  slowRemainingSec,
  toggleReaction,
  validateSend,
  type SendContext,
} from '@/lib/chat/send';
import { ambientBetween, createChatSimulator, slowModeMessages, slowSecondsAt, type MomentContext } from '@/lib/chat-sim/simulator';

const script = chatScript as unknown as ChatScriptFile;
const T0 = Date.parse('2027-01-01T00:00:00Z');
const SEC = 1_000;

const ctx = (over: Partial<SendContext> = {}): SendContext => ({
  now: T0,
  guestId: 'g1',
  nick: 'Мирон',
  flagCode: 'UA',
  hasPass: false,
  canWrite: () => true,
  slowSeconds: 0,
  sentAt: [],
  available: true,
  ...over,
});
const req = (text: string, room = 'world' as const) => ({ clientId: 'c1', room, text });

describe('hasLink', () => {
  it.each(['https://example.com', 'http://a.b', 'www.example.com', 'дивись example.com/thames', 'my.site.org', 'EXAMPLE.COM'])(
    '«%s» — посилання',
    (text) => expect(hasLink(text)).toBe(true),
  );
  it.each(['З Новим роком!', 'Happy New Year, друзі.', 'о 23.59 буде салют', 'написав@Karim', 'Привіт.Усім'])('«%s» — не посилання', (text) =>
    expect(hasLink(text)).toBe(false),
  );
});

describe('validateSend / sendMessage (contracts/chat.md)', () => {
  it('без ніка → nick-required, повідомлення не створюється', () => {
    const r = sendMessage(req('Привіт'), ctx({ nick: undefined }));
    expect(r).toEqual({ ok: false, error: 'nick-required' });
  });
  it('посилання → link-forbidden', () => {
    expect(validateSend(req('глянь www.example.com'), ctx())).toEqual({ error: 'link-forbidden' });
  });
  it('понад 200 символів → too-long; рівно 200 проходить', () => {
    expect(validateSend(req('а'.repeat(MAX_TEXT + 1)), ctx())).toEqual({ error: 'too-long' });
    expect(validateSend(req('а'.repeat(MAX_TEXT)), ctx())).toBeNull();
  });
  it('повільний режим → slow-mode з залишком секунд', () => {
    const r = sendMessage(req('Привіт'), ctx({ slowSeconds: 15, sentAt: [T0 - 7 * SEC] }));
    expect(r).toEqual({ ok: false, error: 'slow-mode', retryInSec: 8 });
  });
  it('після паузи повільного режиму можна', () => {
    expect(validateSend(req('Привіт'), ctx({ slowSeconds: 15, sentAt: [T0 - 15 * SEC] }))).toBeNull();
  });
  it('недоступний чат, бан, закрита кімната', () => {
    expect(validateSend(req('Привіт'), ctx({ available: false }))).toEqual({ error: 'unavailable' });
    expect(validateSend(req('Привіт'), ctx({ banned: true }))).toEqual({ error: 'banned' });
    expect(validateSend({ ...req('Привіт'), room: 'country:GB' }, ctx({ canWrite: () => false }))).toEqual({
      error: 'room-forbidden',
    });
  });
  it('порожній текст не пропускається', () => {
    expect(validateSend(req('   '), ctx())).toEqual({ error: 'empty' });
  });

  it('оптимістичне own-повідомлення: формат ChatMessage, isMine, відповідь', () => {
    const r = sendMessage(req('  З Новим роком!  '), ctx({ hasPass: true, replyTo: { id: 'm1', nick: 'Аміра', excerpt: 'Привіт з Торонто!' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toMatchObject({
      room: 'world',
      kind: 'regular',
      createdAt: T0,
      text: 'З Новим роком!',
      moderation: 'ok',
      author: { id: 'g1', nick: 'Мирон', flagCode: 'UA', badges: ['pass'], isMine: true },
      replyTo: { id: 'm1', nick: 'Аміра', excerpt: 'Привіт з Торонто!' },
    });
    expect(r.message.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('власний автор: лише позначка пасу, без позначки й емоції «Першого ряду» (прибрано 2026-11-12)', () => {
    const r = sendMessage({ ...req('Привіт'), room: 'country:GB' }, ctx({ hasPass: false }));
    expect(r.ok && r.message.author).toEqual({ id: 'g1', nick: 'Мирон', flagCode: 'UA', badges: [], isMine: true });
  });
});

describe('slowRemainingSec', () => {
  it('рахує від останнього відправлення; «машина часу» назад не блокує', () => {
    expect(slowRemainingSec([T0 - 3 * SEC, T0 - 10 * SEC], T0, 15)).toBe(12);
    expect(slowRemainingSec([T0 + 3_600 * SEC], T0, 15)).toBe(0);
    expect(slowRemainingSec([], T0, 15)).toBe(0);
    expect(slowRemainingSec([T0 - 1 * SEC], T0, 0)).toBe(0);
  });
});

describe('excerptOf, toggleReaction', () => {
  it('цитата ≤ 60 символів', () => {
    expect(excerptOf('а'.repeat(100))).toHaveLength(60);
    expect(excerptOf('Привіт')).toBe('Привіт');
  });
  it('реакція ставиться, знімається й не йде нижче нуля', () => {
    const on = toggleReaction({ clap: { count: 12, mine: false } }, 'clap', true);
    expect(on.clap).toEqual({ count: 13, mine: true });
    const off = toggleReaction(on, 'clap', false);
    expect(off.clap).toEqual({ count: 12, mine: false });
    expect(toggleReaction(undefined, 'heart', true).heart).toEqual({ count: 1, mine: true });
    expect(toggleReaction({ heart: { count: 1, mine: true } }, 'heart', false).heart).toBeUndefined();
  });
});

describe('validateNick', () => {
  it('2–20 символів; без посилань; зайнятий; заборонений', () => {
    expect(validateNick('А')).toBe('short');
    expect(validateNick('а'.repeat(21))).toBe('long');
    expect(validateNick('Мирон')).toBeNull();
    expect(validateNick('Ab')).toBeNull();
    expect(validateNick('a'.repeat(20))).toBeNull();
    expect(validateNick('www.site.com')).toBe('link');
    expect(validateNick('аміра', ['Аміра'])).toBe('taken');
    expect(validateNick('Admin')).toBe('forbidden');
  });
});

describe('фоновий потік (ambient)', () => {
  const london: MomentContext = {
    t0: T0,
    eventId: 'evt_london_2027',
    cityId: 'london',
    countries: [{ iso: 'GB', gender: 'f' }],
    eventIds: ['evt_london_2027'],
  };
  const idle = T0 - 3 * 3_600 * SEC;

  it('дехто з авторів згодом видаляє своє повідомлення (deleteAt через 15–45 с; приблизно 1 з 12)', () => {
    const near = ambientBetween(script, [london], ['world'], T0 - 300 * SEC, T0 + 300 * SEC);
    const marked = near.filter((m) => m.deleteAt !== undefined);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(near.length / 5);
    for (const m of marked) {
      expect(m.deleteAt! - m.createdAt).toBeGreaterThanOrEqual(15 * SEC);
      expect(m.deleteAt! - m.createdAt).toBeLessThanOrEqual(45 * SEC);
      expect(m.replyTo).toBeUndefined();
    }
  });

  it('детермінований: той самий проміжок — ті самі повідомлення з тими самими id', () => {
    const a = ambientBetween(script, [london], ['world'], idle, idle + 600 * SEC);
    const b = ambientBetween(script, [london], ['world'], idle, idle + 600 * SEC);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
    expect(new Set(a.map((m) => m.id)).size).toBe(a.length);
    expect(a.every((m) => m.kind === 'regular' && m.room === 'world' && m.author && m.text)).toBe(true);
  });

  it('біля півночі частіше, ніж у тиші (nearMidnight ≫ idle)', () => {
    const quiet = ambientBetween(script, [london], ['world'], idle, idle + 600 * SEC).length;
    const busy = ambientBetween(script, [london], ['world'], T0 - 300 * SEC, T0 + 300 * SEC).length;
    expect(busy).toBeGreaterThan(quiet);
  });

  it('частота множиться на швидкість, але не перевищує 40 повідомлень/с реального часу', () => {
    const slow = ambientBetween(script, [london], ['world'], T0 - 60 * SEC, T0, 1).length;
    const fast = ambientBetween(script, [london], ['world'], T0 - 60 * SEC, T0, 600).length;
    // На швидкості 600 стеля 40/600 на секунду часу сценарію — менше, ніж природна частота 25/хв.
    expect(fast).toBeLessThanOrEqual(slow);
  });

  it('країна — з правил country:*', () => {
    const country = ambientBetween(script, [london], ['country:GB'], idle, idle + 900 * SEC);
    expect(country.length).toBeGreaterThan(0);
  });

  it('simulator з ambient: world отримує потік, без ambient — лише моменти', () => {
    const base = { script, moments: [london], rooms: ['world'] as const, backfillMs: 600 * SEC };
    const plain = createChatSimulator({ ...base, rooms: [...base.rooms] }).advance(idle + 600 * SEC);
    const rich = createChatSimulator({ ...base, rooms: [...base.rooms], ambient: true }).advance(idle + 600 * SEC);
    expect(plain).toEqual([]);
    expect(rich.length).toBeGreaterThan(0);
  });
});

describe('повільний режим сценарію', () => {
  it('вікно 00:00–00:10 у кімнаті world; системне повідомлення на початку', () => {
    expect(slowSecondsAt(script, 'world', T0 + 60 * SEC)).toBe(15);
    expect(slowSecondsAt(script, 'world', T0 - 60 * SEC)).toBe(0);
    expect(slowSecondsAt(script, 'world', T0 + 11 * 60 * SEC)).toBe(0);
    expect(slowSecondsAt(script, 'country:GB', T0 + 60 * SEC)).toBe(0);
    const msgs = slowModeMessages(script, ['world'], T0 - SEC, T0 + SEC);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ kind: 'system', room: 'world', createdAt: T0, system: { kind: 'slow-mode', seconds: 15 } });
    expect(slowModeMessages(script, ['country:GB'], T0 - SEC, T0 + SEC)).toEqual([]);
  });
});
