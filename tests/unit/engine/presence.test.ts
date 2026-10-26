import { afterEach, describe, expect, it } from 'vitest';
import type { MomentStamp } from '@/lib/events/types';
import { buildStamp, presenceMoment, presenceOf, presentEvents, type PresenceSurface } from '@/lib/engine/presence';
import { clearPresenceRegistry, grantStamps, registerSurface, surfacePresence } from '@/lib/presence/useStampGrant';
import { useGuestStore } from '@/stores/guest';
import { LONDON_MIDNIGHT, MIN, SEC } from '../fixtures/data';

const london = { id: 'evt_london_2027', midnightUtc: '2027-01-01T00:00:00Z', countryIso: 'GB', cityId: 'london' };
const T0 = LONDON_MIDNIGHT;

function surface(openedAt: number, extra: Partial<PresenceSurface> = {}): PresenceSurface {
  return { source: 'air', eventIds: [london.id], openedAt, ...extra };
}

describe('presenceOf', () => {
  it('до півночі присутності ще немає', () => {
    expect(presenceOf(surface(T0 - 10 * MIN), T0 - 1, london)).toBeNull();
  });

  it('відкрита до півночі — присутня з півночі', () => {
    expect(presenceOf(surface(T0 - 10 * MIN), T0, london)).toBe('air');
    expect(presenceOf(surface(T0 - 10 * MIN), T0 + 15 * SEC, london)).toBe('air');
  });

  it('пільговий інтервал: відкриття в межах 15 с після півночі зараховується', () => {
    expect(presenceOf(surface(T0 + 10 * SEC), T0 + 15 * SEC, london)).toBe('air');
    expect(presenceOf(surface(T0 + 15 * SEC), T0 + 15 * SEC, london)).toBe('air');
  });

  it('відкриття пізніше ніж через 15 с — не зараховується', () => {
    expect(presenceOf(surface(T0 + 16 * SEC), T0 + 20 * SEC, london)).toBeNull();
  });

  it('закрита до півночі — не присутня; закрита після півночі — присутня', () => {
    expect(presenceOf(surface(T0 - 5 * MIN, { closedAt: T0 - 1 }), T0 + 15 * SEC, london)).toBeNull();
    expect(presenceOf(surface(T0 - 5 * MIN, { closedAt: T0 + 5 * SEC }), T0 + 15 * SEC, london)).toBe('air');
  });

  it('поверхня іншої події — не присутня', () => {
    expect(presenceOf({ source: 'country', eventIds: ['evt_paris_2027'], openedAt: T0 - MIN }, T0, london)).toBeNull();
  });

  it('момент присутності: північ або відкриття в пільговому інтервалі', () => {
    expect(presenceMoment(surface(T0 - MIN), london)).toBe(T0);
    expect(presenceMoment(surface(T0 + 7 * SEC), london)).toBe(T0 + 7 * SEC);
  });

  it('кілька поверхонь: країна важливіша за ефір', () => {
    const out = presentEvents(
      [surface(T0 - MIN), { source: 'country', eventIds: [london.id], openedAt: T0 - MIN }],
      [london],
      T0 + 15 * SEC,
    );
    expect(out).toEqual({ [london.id]: 'country' });
  });
});

describe('buildStamp', () => {
  it('grantedAt — північ + 15 с, знімок назви міста й країни', () => {
    const s = buildStamp({
      event: london,
      country: { illustrationId: 'gb-postcard' },
      city: { name: { uk: 'Лондон' } },
      presenceSource: 'air',
      firstRowSeat: 4,
    });
    expect(s).toEqual({
      eventId: london.id,
      grantedAt: T0 + 15 * SEC,
      presenceSource: 'air',
      illustrationId: 'gb-postcard',
      cityName: 'Лондон',
      countryIso: 'GB',
      firstRowSeat: 4,
    });
  });
});

describe('реєстр поверхонь і нарахування', () => {
  afterEach(() => {
    clearPresenceRegistry();
    useGuestStore.getState().resetGuest();
  });

  const stampPayload = (present: string[]): MomentStamp => ({
    eventKey: 'stamp:2027-01-01T00:00:00Z',
    at: T0 + 15 * SEC,
    firedAt: T0 + 15 * SEC,
    slotMidnightUtc: '2027-01-01T00:00:00Z',
    eventIds: [london.id, 'evt_canary_2027'],
    presentEventIds: present,
    presenceSources: Object.fromEntries(present.map((id) => [id, 'air' as const])),
    countries: [{ iso: 'GB', gender: 'f' }],
    announce: { cityId: 'london', text: 'midnight-stamp-ready' },
  });

  it('surfacePresence бачить відкриту поверхню навіть без записаної присутності', () => {
    const off = registerSurface(surface(T0 - MIN));
    expect(surfacePresence([london.id, 'evt_canary_2027'], T0 + 15 * SEC)).toEqual({ [london.id]: 'air' });
    off();
    expect(surfacePresence([london.id], T0 + 15 * SEC)).toEqual({});
  });

  it('пішов між північчю й «+15 с» — присутність із pendingPresence', () => {
    useGuestStore.getState().markPresence(london.id, T0, 'air');
    expect(surfacePresence([london.id], T0 + 15 * SEC)).toEqual({ [london.id]: 'air' });
  });

  it('штамп один на подію, пауза відео значення не має', () => {
    expect(grantStamps(stampPayload([london.id]))).toEqual([london.id]);
    expect(grantStamps(stampPayload([london.id]))).toEqual([]);
    const stamps = useGuestStore.getState().stamps;
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({ eventId: london.id, grantedAt: T0 + 15 * SEC, cityName: 'Лондон', countryIso: 'GB' });
  });

  it('без присутності штампа немає', () => {
    expect(grantStamps(stampPayload([]))).toEqual([]);
    expect(useGuestStore.getState().stamps).toEqual([]);
  });
});
