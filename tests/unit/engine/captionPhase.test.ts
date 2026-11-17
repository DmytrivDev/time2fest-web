import { describe, expect, it } from 'vitest';
import { captionPhase } from '@time2fest/rules/time';
import { event, LONDON_MIDNIGHT, MIN, RIO_MIDNIGHT, SEC } from '../fixtures/data';

const london = event('london', LONDON_MIDNIGHT);
const rio = event('rio', RIO_MIDNIGHT, { countryIso: 'BR' });
const at = (t: number) => LONDON_MIDNIGHT + t;

describe('captionPhase · broadcast', () => {
  const ph = (t: number) => captionPhase(at(t), london, 'broadcast', rio);

  it('< −15 хв: before, countdown, midnight-at, без прапорців', () => {
    const p = ph(-20 * MIN);
    expect(p).toMatchObject({
      id: 'before',
      row1Right: { kind: 'countdown', ms: 20 * MIN },
      row3: { kind: 'midnight-at', eventId: london.id },
      button: 'choose-stream',
      flags: { howTo: false, delayNotice: false, momentFired: false },
    });
  });

  it('межа −15 хв: з’являється howTo', () => {
    expect(ph(-15 * MIN - 1).flags.howTo).toBe(false);
    expect(ph(-15 * MIN).flags).toEqual({ howTo: true, delayNotice: false, momentFired: false });
  });

  it('межа −5 хв: delayNotice; відлік не замінюється часом події', () => {
    expect(ph(-5 * MIN - 1).flags.delayNotice).toBe(false);
    const p = ph(-5 * MIN);
    expect(p.flags).toEqual({ howTo: true, delayNotice: true, momentFired: false });
    expect(p.row1Right).toEqual({ kind: 'countdown', ms: 5 * MIN });
    expect(p.row3.kind).toBe('midnight-at');
  });

  it('0 … +15 с: celebrating, таймера немає, «зустріла» (не «до півночі 00:00:00» після півночі, 2026-11-14)', () => {
    for (const t of [0, 10 * SEC, 15 * SEC - 1]) {
      const p = ph(t);
      expect(p.id).toBe('celebrating');
      expect(p.row1Right).toEqual({ kind: 'year' });
      expect(p.row3.kind).toBe('met');
      expect(p.flags).toEqual({ howTo: true, delayNotice: true, momentFired: false });
    }
  });

  it('+15 с … +14 хв: none, met, momentFired', () => {
    for (const t of [15 * SEC, 13 * MIN + 59 * SEC]) {
      const p = ph(t);
      expect(p).toMatchObject({
        id: 'celebrating',
        row1Right: { kind: 'year' },
        row3: { kind: 'met', eventId: london.id },
        button: 'choose-stream',
        flags: { howTo: false, delayNotice: false, momentFired: true },
      });
    }
  });

  it('+14 хв … +15 хв: last-minute, «перехід через …», «Лишитися тут ›»', () => {
    const p = ph(14 * MIN);
    expect(p).toMatchObject({
      id: 'last-minute',
      row1Right: { kind: 'handover', ms: 60 * SEC },
      row3: { kind: 'next', nextEventId: rio.id },
      button: 'stay-here',
      flags: { momentFired: true },
    });
    expect(ph(14 * MIN + 1 * SEC).row1Right).toEqual({ kind: 'handover', ms: 59 * SEC });
  });

  it('кнопка «Лишитися тут ›» лише в last-minute', () => {
    const buttons = [-20 * MIN, -10 * MIN, -1 * MIN, 0, 20 * SEC, 13 * MIN, 14 * MIN, 15 * MIN].map(
      (t) => [t, ph(t).button] as const,
    );
    for (const [t, b] of buttons) expect(b).toBe(t === 14 * MIN ? 'stay-here' : 'choose-stream');
  });

  it('≥ +15 хв: next — фаза before наступної події', () => {
    const p = ph(15 * MIN);
    expect(p.id).toBe('next');
    expect(p.row1Right).toEqual({ kind: 'countdown', ms: RIO_MIDNIGHT - at(15 * MIN) });
    expect(p.row3).toEqual({ kind: 'midnight-at', eventId: rio.id });
    expect(p.button).toBe('choose-stream');
  });

  it('між фазами змінюються лише правий край рядка 1 і рядок 3 (інші поля мають ту саму форму)', () => {
    const keys = Object.keys(ph(-20 * MIN)).sort();
    for (const t of [-10 * MIN, 0, 20 * SEC, 14 * MIN, 15 * MIN]) expect(Object.keys(ph(t)).sort()).toEqual(keys);
  });
});

describe('captionPhase · remote (сторінка країни)', () => {
  const ph = (t: number, hasReplay = false) => captionPhase(at(t), london, 'remote', rio, { hasReplay });

  it('до +15 с — як broadcast', () => {
    expect(ph(-20 * MIN)).toEqual(captionPhase(at(-20 * MIN), london, 'broadcast', rio));
    expect(ph(5 * SEC)).toEqual(captionPhase(at(5 * SEC), london, 'broadcast', rio));
  });

  it('ніколи не переходить сам: без last-minute і next', () => {
    for (const t of [14 * MIN, 14 * MIN + 30 * SEC, 15 * MIN, 29 * MIN]) {
      const p = ph(t);
      expect(p).toMatchObject({ id: 'celebrating', row1Right: { kind: 'year' }, row3: { kind: 'met' }, button: 'choose-stream' });
    }
  });

  it('після RECORDING_AFTER — ago і met-and-next; «Подивитися північ ще раз» лише з повтором', () => {
    const p = ph(40 * MIN);
    expect(p.row1Right).toEqual({ kind: 'ago', ms: 40 * MIN });
    expect(p.row3).toEqual({ kind: 'met-and-next', eventId: london.id, nextEventId: rio.id });
    expect(p.button).toBe('choose-stream');
    expect(ph(40 * MIN, true).button).toBe('watch-again');
  });
});
