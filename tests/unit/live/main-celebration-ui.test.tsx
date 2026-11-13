import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Caption, type CaptionPlace } from '@/components/live/Caption';
import { WaitingScene } from '@/components/player/CountdownScene';
import { captionPhase } from '@/lib/engine/captionPhase';
import { event, MIN, PARIS_MIDNIGHT, SEC } from '../fixtures/data';
import { renderApp as renderWithApp } from '../us1/render';

// Рішення власника 2026-11-13: заглушка головного святкування й рядок «Головне святкування почалось · Перемкнути».

const france = { name: { uk: 'Франція' }, flagCode: 'FR', illustrationId: 'fr-postcard' };
const paris = event('paris', PARIS_MIDNIGHT, { countryIso: 'FR', zoneId: 'utc+0100' });
const place: CaptionPlace = {
  midnightMs: PARIS_MIDNIGHT,
  city: { name: { uk: 'Берлін' }, landmark: { uk: 'Бранденбурзькі ворота' } } as CaptionPlace['city'],
  country: { name: { uk: 'Німеччина' }, gender: 'f', flagCode: 'DE' } as CaptionPlace['country'],
  href: '/country/nimechchyna/',
};
const phaseAt = (t: number) => captionPhase(PARIS_MIDNIGHT + t, paris, 'broadcast', null);

beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});

describe('заглушка «Трансляція очікується»', () => {
  const startsAt = PARIS_MIDNIGHT - 9 * MIN;

  it('початок відомий: «Почнеться о … за твоїм часом» і відлік з підписом «до початку»', () => {
    renderWithApp(<WaitingScene country={france} waitingFor={{ title: 'Париж · салют над Ейфелевою вежею', startsAt }} />, startsAt - (8 * MIN + 24 * SEC));
    expect(screen.getByText(/Почнеться о/)).toHaveTextContent('за твоїм часом');
    const left = document.querySelector('[data-waiting-left]')!;
    expect(left).toHaveTextContent('до початку 08:24');
    expect(screen.queryByText('Відео ввімкнеться саме, щойно трансляція почнеться', { selector: '[data-waiting-unknown]' })).toBeNull();
  });

  it('початок невідомий: ні часу, ні числа — «Відео ввімкнеться саме, щойно трансляція почнеться»', () => {
    renderWithApp(<WaitingScene country={france} waitingFor={{ title: 'Париж · салют над Ейфелевою вежею', startsAt: null }} />, startsAt - MIN);
    expect(document.querySelector('[data-scene="waiting"]')).toHaveAttribute('data-starts', 'unknown');
    expect(document.querySelector('[data-waiting-unknown]')).toHaveTextContent('Відео ввімкнеться саме, щойно трансляція почнеться');
    expect(document.querySelector('[data-waiting-left]')).toBeNull();
    expect(screen.queryByText(/Почнеться о/)).toBeNull();
  });

  it('початок уже минув (а трансляції ще немає) — так само без часу й без числа', () => {
    renderWithApp(<WaitingScene country={france} waitingFor={{ title: 'Париж', startsAt }} />, startsAt + 2 * MIN);
    expect(document.querySelector('[data-waiting-left]')).toBeNull();
    expect(document.querySelector('[data-waiting-unknown]')).not.toBeNull();
  });

  it('вікно кімнати: число лише з підписом, невідомий початок — «Відео ввімкнеться саме»', () => {
    const { unmount } = renderWithApp(<WaitingScene compact country={france} waitingFor={{ title: 'Париж', startsAt }} />, startsAt - 90 * SEC);
    expect(document.querySelector('[data-waiting-left]')).toHaveTextContent('до початку 01:30');
    unmount();
    renderWithApp(<WaitingScene compact country={france} waitingFor={{ title: 'Париж', startsAt: null }} />, startsAt - 90 * SEC);
    expect(document.querySelector('[data-waiting-unknown]')).toHaveTextContent('Відео ввімкнеться саме');
  });

  it('кнопка «Дивитися, що вже йде» — лише коли її передали (у поясі щось іде наживо)', () => {
    const onWatchLive = vi.fn();
    const { unmount } = renderWithApp(<WaitingScene country={france} waitingFor={{ title: 'Париж', startsAt }} onWatchLive={onWatchLive} />, startsAt - MIN);
    fireEvent.click(screen.getByRole('button', { name: 'Дивитися, що вже йде' }));
    expect(onWatchLive).toHaveBeenCalledOnce();
    unmount();
    renderWithApp(<WaitingScene country={france} waitingFor={{ title: 'Париж', startsAt }} />, startsAt - MIN);
    expect(screen.queryByRole('button', { name: 'Дивитися, що вже йде' })).toBeNull();
  });
});

describe('рядок «Головне святкування почалось · Перемкнути» (той самий слот, що й підказка про штамп)', () => {
  it('телефон: два рядки на місці назви, увесь блок — одна кнопка; дотик перемикає', () => {
    const onSwitch = vi.fn();
    renderWithApp(
      <Caption variant="bar" phase={phaseAt(-5 * MIN)} current={place} title="Берлін · Бранденбурзькі ворота" live notice={{ place: 'Париж', onSwitch }} timeZone="Europe/Kyiv" />,
      PARIS_MIDNIGHT - 5 * MIN,
    );
    const btn = screen.getByRole('button', { name: /Головне святкування.*почалось · Перемкнути/ });
    fireEvent.click(btn);
    expect(onSwitch).toHaveBeenCalledOnce();
    // Назва лишається для зчитувача; «Наживо» поступається місцем (як із підказкою про штамп).
    expect(screen.getByRole('heading', { name: /Берлін/ })).toHaveClass('sr-only');
  });

  it('підказка про штамп старша: обидва не показуються разом', () => {
    renderWithApp(
      <Caption variant="bar" phase={phaseAt(-30 * SEC)} current={place} live stampHint="Франція" notice={{ place: 'Париж', onSwitch: () => {} }} timeZone="Europe/Kyiv" />,
      PARIS_MIDNIGHT - 30 * SEC,
    );
    expect(document.querySelector('[data-stamp-hint]')).not.toBeNull();
    expect(document.querySelector('[data-main-live]')).toBeNull();
  });

  it('десктоп: у рядку 1 на місці «Зараз дивляться…» з кнопкою «Перемкнути»', () => {
    const onSwitch = vi.fn();
    renderWithApp(<Caption phase={phaseAt(-5 * MIN)} current={place} live watchers={12} notice={{ place: 'Париж', onSwitch }} timeZone="Europe/Kyiv" />, PARIS_MIDNIGHT - 5 * MIN);
    expect(document.querySelector('[data-main-live]')).toHaveTextContent('Головне святкування почалось');
    expect(screen.queryByText(/Зараз дивляться люди/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Перемкнути' }));
    expect(onSwitch).toHaveBeenCalledOnce();
  });

  it('назва — тієї трансляції, що грає (заголовок і рядок часу)', () => {
    renderWithApp(<Caption variant="bar" phase={phaseAt(-5 * MIN)} current={place} title="Гамбург · порт" live timeZone="Europe/Kyiv" />, PARIS_MIDNIGHT - 5 * MIN);
    expect(screen.getByRole('heading')).toHaveTextContent('Гамбург');
  });
});
