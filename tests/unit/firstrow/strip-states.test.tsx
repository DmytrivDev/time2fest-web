import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FirstRowStrip } from '@/components/firstrow/FirstRowStrip';
import type { FirstRowStripProps } from '@/components/firstrow/types';
import type { Dataset, ScheduledEvent } from '@/lib/data/types';
import { otherOpenRows } from '@/lib/firstrow/pick';
import { makeView, MIDNIGHT } from '../../../stories/firstrow/fixtures';
import { renderWithApp } from '../_support/render';

// Підказки й бігуча стрічка питають matchMedia / ResizeObserver — у jsdom їх немає.
beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});

const OPEN_AT = '2026-12-31T23:00:00Z';
const CLOSED_AT = '2026-12-31T23:57:00Z';
const noop = () => undefined;
function strip(p: Partial<FirstRowStripProps> & Pick<FirstRowStripProps, 'view' | 'seats'>, now = OPEN_AT) {
  return renderWithApp(<FirstRowStrip city="Лондон" midnightMs={MIDNIGHT} takeVariant="tonal" onTake={noop} onInfo={noop} {...p} />, now);
}

describe('«Перший ряд» до півночі: стани смуги (дошки 2026-10-31)', () => {
  it('лишилось 1: лічильник «1 з 10», «останнє місце», «Зайняти місце»', () => {
    strip(makeView({ taken: 9 }));
    expect(screen.getByText('останнє місце')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зайняти місце' })).toBeInTheDocument();
  });

  it('розпродано: без «Зайняти місце», посилання «Ще є місця: … і ще 3» відкриває список', () => {
    const onOpen = vi.fn();
    strip({ ...makeView({ taken: 10 }), soldOutAlt: { city: 'Лісабон', more: 3, onOpen } });
    expect(screen.queryByRole('button', { name: 'Зайняти місце' })).toBeNull();
    expect(screen.getByText('Розпродано')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ще є місця: Перший ряд · Лісабон і ще 3/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('продаж закрито (за 5 хв до півночі): позначка, пояснення, без кнопки й без пунктирної «вільних»', () => {
    const { container } = strip(makeView({ taken: 6, closed: true }), CLOSED_AT);
    expect(screen.getByText('Продаж закрито')).toBeInTheDocument();
    expect(screen.getByText(/Продаж закривається за 5 хвилин до півночі/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Зайняти місце' })).toBeNull();
    expect(container.querySelector('[data-slot="free"]')).toBeNull();
  });

  it('у тебе є місце: «Моя емоція» і «Квиток · місце 3»', () => {
    strip(makeView({ taken: 8, mine: 3 }));
    expect(screen.getByRole('button', { name: /Моя емоція/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Квиток · місце 3' })).toBeInTheDocument();
  });

  it('телефон: у заголовку коротка пігулка («1 з 10», «Розпродано», «Закрито», «Місце 3»)', () => {
    const { unmount } = strip({ ...makeView({ taken: 9 }), layout: 'compact' });
    expect(screen.getByRole('button', { name: /Перший ряд · Лондон/ })).toHaveTextContent('1 з 10');
    unmount();
    const r2 = strip({ ...makeView({ taken: 10 }), layout: 'compact' });
    expect(screen.getByRole('button', { name: /Перший ряд · Лондон/ })).toHaveTextContent('Розпродано');
    expect(screen.queryByRole('button', { name: 'Зайняти місце' })).toBeNull();
    r2.unmount();
    const r3 = strip({ ...makeView({ taken: 6, closed: true }), layout: 'compact' }, CLOSED_AT);
    expect(screen.getByRole('button', { name: /Перший ряд · Лондон/ })).toHaveTextContent('Закрито');
    r3.unmount();
    strip({ ...makeView({ taken: 8, mine: 3 }), layout: 'compact' });
    expect(screen.getByRole('button', { name: /Перший ряд · Лондон/ })).toHaveTextContent('Місце 3');
  });
});

describe('«Ще є місця»: порядок рядів', () => {
  const T = Date.parse('2026-12-31T23:30:00Z');
  const ev = (id: string, midnight: string, main = true, popularity = 50): ScheduledEvent =>
    ({ id, cityId: id, countryIso: 'XX', midnightUtc: midnight, midnightMs: Date.parse(midnight), isMainCelebration: main, popularity, firstRow: { saleEnabled: true } }) as unknown as ScheduledEvent;
  const london = ev('london', '2027-01-01T00:00:00Z', true, 95);
  const data = {
    events: [
      london,
      ev('rio', '2027-01-01T03:00:00Z', true, 90),
      ev('lisbon', '2027-01-01T00:00:00Z', true, 55),
      ev('dublin', '2027-01-01T00:00:00Z', true, 80),
      ev('ny', '2027-01-01T05:00:00Z', true, 98),
      ev('paris', '2026-12-31T23:00:00Z', true, 90), // продаж уже закрито
      ev('porto', '2027-01-01T00:00:00Z', false, 99), // не головне
    ],
  } as Pick<Dataset, 'events'>;

  it('та сама північ → наступна; серед однакових — головне, потім популярніше; розпроданих і закритих немає', () => {
    const rows = otherOpenRows(data, T, london, (e) => (e.id === 'ny' ? 0 : 5));
    expect(rows.map((r) => r.event.id)).toEqual(['dublin', 'lisbon', 'porto', 'rio']);
  });

  it('ряд з 1–2 місцями першим не ставимо, якщо є інший', () => {
    const rows = otherOpenRows(data, T, london, (e) => (e.id === 'dublin' ? 2 : e.id === 'ny' ? 0 : 5));
    expect(rows.map((r) => r.event.id)).toEqual(['lisbon', 'dublin', 'porto', 'rio']);
  });
});
