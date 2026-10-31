import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { nextWithGreeting, newYearOf, postcardOrder } from '@/components/firstrow/FirstRowPostcard';
import { FirstRowStrip } from '@/components/firstrow/FirstRowStrip';
import type { FirstRowStripProps } from '@/components/firstrow/types';
import type { FirstRowSeat } from '@/lib/data/types';
import { postcardSvg, wrapWords } from '@/lib/firstrow/postcardImage';
import { makeView, MIDNIGHT } from '../../../stories/firstrow/fixtures';
import { renderWithApp } from '../_support/render';

beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});

const AFTER = '2027-01-01T00:01:00Z';
const noop = () => undefined;

/** Північ минула, місця загорілись; у місця 3 немає привітання. */
function lit(opts: { taken: number; mine?: number }) {
  const { view, seats } = makeView(opts);
  const s2 = seats.map((s): FirstRowSeat =>
    s.state === 'taken' ? { ...s, participant: { ...s.participant, greeting: s.number === 3 ? '' : `Привіт від ${s.participant.name}` } } : s,
  );
  return { view: { ...view, state: 'closed' as const, wall: { phase: 'lit' as const, lightingFrom: MIDNIGHT } }, seats: s2 };
}
function strip(p: Partial<FirstRowStripProps> & Pick<FirstRowStripProps, 'view' | 'seats'>) {
  return renderWithApp(<FirstRowStrip city="Лондон" midnightMs={MIDNIGHT} takeVariant="tonal" onTake={noop} onInfo={noop} {...p} />, AFTER);
}

describe('«Перший ряд» після півночі — листівка (рішення 2026-10-31)', () => {
  it('замість стіни й бігучого рядка — «З Новим 2027 роком!», усі місця й привітання першого', () => {
    const { container } = strip(lit({ taken: 6 }));
    expect(screen.getByText(/З Новим 2027 роком!/)).toBeInTheDocument();
    expect(container.querySelector('[data-row="ticker"]')).toBeNull();
    expect(container.querySelectorAll('[data-postcard] [data-seat]')).toHaveLength(6);
    expect(container.querySelector('[data-row="greeting"]')).toHaveTextContent('«Привіт від Олена і друзі»');
    expect(container.querySelector('[data-seat="1"]')).toHaveAttribute('aria-pressed', 'true');
  });

  it('натиск на фішку показує її привітання; повторний — картка учасника', () => {
    const onOpenParticipant = vi.fn();
    const { container } = strip({ ...lit({ taken: 6 }), onOpenParticipant });
    const tom = container.querySelector<HTMLElement>('[data-postcard] [data-seat="3"]')!;
    fireEvent.click(tom);
    expect(tom).toHaveAttribute('aria-pressed', 'true');
    // У Tom немає привітання — емоція й «Зустрічає північ тут».
    expect(container.querySelector('[data-row="greeting"]')).toHaveTextContent('Зустрічає північ тут');
    expect(onOpenParticipant).not.toHaveBeenCalled();
    fireEvent.click(tom);
    expect(onOpenParticipant).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tom' }));
  });

  it('під привітанням — кнопка автора (картка учасника); своє місце — першим і з «Моя емоція»', () => {
    const onOpenParticipant = vi.fn();
    const { unmount } = strip({ ...lit({ taken: 6 }), onOpenParticipant });
    fireEvent.click(screen.getByRole('button', { name: /Олена і друзі.*відкрити картку учасника/ }));
    expect(onOpenParticipant).toHaveBeenCalledWith(expect.objectContaining({ name: 'Олена і друзі' }));
    unmount();
    const onOpenEmoji = vi.fn();
    const { container } = strip({ ...lit({ taken: 6, mine: 4 }), onOpenEmoji });
    const first = container.querySelector('[data-postcard] [data-seat]')!;
    expect(first).toHaveAttribute('data-seat', '4');
    expect(container.querySelector('[data-row="greeting"]')).toHaveTextContent('Твоє привітання · місце 4');
    fireEvent.click(screen.getByRole('button', { name: /^Моя емоція/ }));
    expect(onOpenEmoji).toHaveBeenCalled();
  });

  it('«Поділитися листівкою» — з власним місцем, якщо воно є, інакше з тим, що на екрані', () => {
    const onSharePostcard = vi.fn();
    strip({ ...lit({ taken: 6, mine: 5 }), onSharePostcard });
    fireEvent.click(screen.getByRole('button', { name: 'Поділитися листівкою' }));
    expect(onSharePostcard).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jonas', isMine: true }));
  });

  it('телефон, своє місце: під листівкою немає блоку «Твоє місце» з часу до півночі', () => {
    const { container } = strip({ ...lit({ taken: 6, mine: 2 }), layout: 'compact' });
    expect(container.querySelector('[data-postcard]')).not.toBeNull();
    expect(screen.queryByText(/Опівночі місце загориться/)).toBeNull();
  });

  it('телефон: у заголовку «🎆 2027», листівка в панелі', () => {
    strip({ ...lit({ taken: 6 }), layout: 'compact', onSharePostcard: noop });
    expect(screen.getByRole('button', { name: /Перший ряд · Лондон/ })).toHaveTextContent('🎆 2027');
    expect(screen.getByRole('button', { name: 'Поділитися листівкою' })).toBeInTheDocument();
  });
});

describe('листівка: порядок, коло, картинка', () => {
  it('порядок — своє першим, далі за номером; коло пропускає місця без привітання', () => {
    const { seats } = lit({ taken: 5, mine: 4 });
    const order = postcardOrder(seats);
    expect(order.map((s) => s.number)).toEqual([4, 1, 2, 3, 5]);
    expect(nextWithGreeting(order, 2)).toBe(5);
    expect(nextWithGreeting(order, 5)).toBe(4);
  });

  it('рік — той, що настає опівночі (і для поясів на схід від UTC)', () => {
    expect(newYearOf(MIDNIGHT)).toBe(2027);
    expect(newYearOf(Date.parse('2026-12-31T10:00:00Z'))).toBe(2027); // Окленд
  });

  it('перенос привітання за словами з «…» понад ліміт рядків', () => {
    expect(wrapWords('раз два три чотири', 8, 3)).toEqual(['раз два', 'три', 'чотири']);
    expect(wrapWords('раз два три чотири пʼять', 8, 2)).toEqual(['раз два', 'три…']);
  });

  it('SVG: 9:16 і 1:1, екранує текст, сіре коло без прапора', () => {
    const text = { kicker: 'ПЕРШИЙ РЯД · ЛОНДОН', title: 'З Новим 2027 роком!', greeting: 'A <b> & "c"', people: [{ name: 'Tom', flagCode: 'GB', emoji: '🎆' }], brand: 'Time2Fest' };
    const story = postcardSvg('story', text);
    expect(story).toContain('width="1080" height="1920"');
    expect(story).toContain('&lt;b&gt; &amp; &quot;c&quot;');
    expect(story).toContain('fill="#74747D"');
    expect(postcardSvg('square', text, { GB: 'data:image/svg+xml,x' })).toContain('href="data:image/svg+xml,x"');
  });
});
