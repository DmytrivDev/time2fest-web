import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FirstRowWall, LIGHTING_STEP_MS, seedToSeats } from '@/components/live/FirstRowWall';
import { SeatPill } from '@/components/live/SeatPill';
import chatScript from '@/data/chat-script.json';
import type { FirstRowSeat, FirstRowSeedEntry } from '@/lib/data/types';
import { useGuestStore } from '@/stores/guest';
import { renderApp, stubBrowserApis } from './render';

const MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');
const seed = (chatScript as unknown as { firstRowSeed: FirstRowSeedEntry[] }).firstRowSeed.find((s) => s.eventId === 'evt_london_2027')!;
const seats: FirstRowSeat[] = seedToSeats(seed, MIDNIGHT - 3_600_000);
const countryName = (code: string) => ({ UA: 'Україна', EG: 'Єгипет', CA: 'Канада', JP: 'Японія' })[code];

beforeAll(stubBrowserApis);
afterEach(() => {
  vi.useRealTimers();
  useGuestStore.setState({ reducedMotion: false });
});

describe('seedToSeats', () => {
  it('9 зайнятих і 1 вільне місце з firstRowSeed', () => {
    expect(seats).toHaveLength(10);
    expect(seats.filter((s) => s.state === 'taken')).toHaveLength(9);
    expect(seats[9]).toMatchObject({ number: 10, state: 'free' });
    expect(seats[0]).toMatchObject({ number: 1, state: 'taken', participant: { name: 'Олена і друзі', flagCode: 'UA', emojiId: 'glasses' } });
  });
});

describe('SeatPill', () => {
  it('доступна назва без емодзі: «Місце 1: Олена і друзі, Україна, емоція: Келихи»', () => {
    renderApp(<SeatPill seat={1} participant={{ name: 'Олена і друзі', flagCode: 'UA', emojiId: 'glasses' }} countryName="Україна" />);
    const pill = screen.getByRole('img', { name: 'Місце 1: Олена і друзі, Україна, емоція: Келихи' });
    expect(pill).toBeInTheDocument();
    expect(pill.getAttribute('aria-label')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(screen.getByText('Олена і друзі')).toBeInTheDocument();
  });

  it('невідома емоція не ламає: запасна «Іскри»', () => {
    renderApp(<SeatPill seat={2} participant={{ name: 'Karim', flagCode: 'EG', emojiId: 'no-such' }} />);
    expect(screen.getByRole('img', { name: 'Місце 2: Karim, емоція: Іскри' })).toBeInTheDocument();
  });

  it('своє місце — кнопка з «Ти», дотик відкриває вибір емоції', () => {
    const onOpen = vi.fn();
    renderApp(<SeatPill seat={4} participant={{ name: 'Мирон', flagCode: 'UA', emojiId: 'fireworks', isMine: true }} countryName="Україна" onOpenEmoji={onOpen} />);
    const btn = screen.getByRole('button', { name: /Місце 4: Мирон, Україна, емоція: Феєрверк\. Твоє місце/ });
    expect(btn).toHaveTextContent('Ти');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('emoji id з chat-script (party, confetti, joy) і старі id мають назви нового набору', () => {
    renderApp(
      <>
        <SeatPill seat={5} participant={{ name: 'Ana Clara', flagCode: 'BR', emojiId: 'party' }} />
        <SeatPill seat={7} participant={{ name: 'Jess', flagCode: 'AU', emojiId: 'confetti' }} />
        <SeatPill seat={9} participant={{ name: 'Mike', flagCode: 'US', emojiId: 'laugh' }} />
      </>,
    );
    expect(screen.getByRole('img', { name: 'Місце 5: Ana Clara, емоція: Свято' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Місце 7: Jess, емоція: Хлопавка' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Місце 9: Mike, емоція: Радість' })).toBeInTheDocument();
  });
});

describe('FirstRowWall', () => {
  it('назва області: «Перший ряд · Лондон: лишилось 1 з 10, гортай вбік»', () => {
    renderApp(<FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="idle" countryName={countryName} />);
    expect(screen.getByRole('region', { name: 'Перший ряд · Лондон: лишилось 1 з 10, гортай вбік' })).toBeInTheDocument();
  });

  it('idle: 9 імен і одна картка вільних місць; привітання немає', () => {
    const { container } = renderApp(<FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="idle" countryName={countryName} />);
    expect(container.querySelectorAll('[data-seat]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-seat][data-state="lit"]')).toHaveLength(0);
    expect(screen.getByText('1 вільне')).toBeInTheDocument();
    expect(screen.queryByText('З Новим роком, перший ряд!')).toBeNull();
  });

  it('усі вільні: «усі місця вільні»', () => {
    renderApp(<FirstRowWall city="Лондон" seats={[]} freeCount={10} phase="idle" />);
    expect(screen.getByText('усі місця вільні')).toBeInTheDocument();
  });

  it('lit: усі зайняті горять, «З Новим роком, перший ряд!»', () => {
    const { container } = renderApp(<FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="lit" countryName={countryName} />);
    expect(container.querySelectorAll('[data-seat][data-state="lit"]')).toHaveLength(9);
    expect(screen.getByRole('status')).toHaveTextContent('З Новим роком, перший ряд!');
  });

  it('restrained: без руху й без привітання, місця не горять', () => {
    const { container } = renderApp(<FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="lit" restrained />);
    expect(container.querySelectorAll('[data-seat][data-state="lit"]')).toHaveLength(0);
    expect(screen.queryByText('З Новим роком, перший ряд!')).toBeNull();
    expect(container.querySelector('[data-wall="restrained"]')).not.toBeNull();
  });

  it('lighting: місця загоряються по черзі, не частіше ~2 на секунду', () => {
    vi.useFakeTimers();
    const from = MIDNIGHT + 15_000;
    const { container } = renderApp(
      <FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="lighting" lightingFrom={from} />,
      from,
    );
    const lit = () => container.querySelectorAll('[data-seat][data-state="lit"]').length;
    expect(LIGHTING_STEP_MS).toBe(500);
    expect(lit()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(LIGHTING_STEP_MS);
    });
    expect(lit()).toBe(2);
    act(() => {
      vi.advanceTimersByTime(LIGHTING_STEP_MS * 3);
    });
    expect(lit()).toBe(5);
    act(() => {
      vi.advanceTimersByTime(LIGHTING_STEP_MS * 20);
    });
    expect(lit()).toBe(9);
  });

  it('lighting: сторінку відкрито посеред загоряння — продовжує з потрібного місця', () => {
    vi.useFakeTimers();
    const from = MIDNIGHT + 15_000;
    const { container } = renderApp(
      <FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="lighting" lightingFrom={from} />,
      from + 2_100,
    );
    expect(container.querySelectorAll('[data-seat][data-state="lit"]')).toHaveLength(5);
  });

  it('зменшити рух: lighting одразу показує всі місця як lit', () => {
    useGuestStore.setState({ reducedMotion: true });
    const { container } = renderApp(
      <FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="lighting" lightingFrom={MIDNIGHT + 15_000} />,
      MIDNIGHT + 15_000,
    );
    expect(container.querySelectorAll('[data-seat][data-state="lit"]')).toHaveLength(9);
    expect(container.querySelectorAll('[data-fresh="true"]')).toHaveLength(0);
  });

  it('своє місце відкриває вибір емоції', () => {
    const onOpen = vi.fn();
    const mine = seats.map((s) => (s.state === 'taken' && s.number === 4 ? { ...s, participant: { ...s.participant, isMine: true } } : s));
    renderApp(<FirstRowWall city="Лондон" seats={mine} freeCount={1} phase="idle" onOpenEmoji={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Місце 4/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('сітка: список імен 2 колонки з назвою «Перший ряд · Лондон · 9 з 10»', () => {
    renderApp(<FirstRowWall city="Лондон" seats={seats} freeCount={1} phase="lit" layout="grid" />);
    expect(screen.getByRole('region', { name: 'Перший ряд · Лондон · 9 з 10' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(9);
  });
});
