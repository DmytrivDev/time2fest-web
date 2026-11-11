import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountdownScene } from '@/components/player/CountdownScene';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import type { Country } from '@/lib/data/types';
import { CoralProvider, useCoralWindowOpen } from '@/lib/overlay/coral';
import { useGuestStore } from '@/stores/guest';
import { renderApp } from './render';

const GREENLAND: Pick<Country, 'name' | 'flagCode' | 'illustrationId' | 'howTo'> = {
  name: { uk: 'Гренландія' },
  flagCode: 'GL',
  illustrationId: 'postcard-template',
  howTo: {
    text: '',
    traditions: [
      { id: 't1', title: 'Два Нові роки', text: 'О 20:00 вітають Данію, опівночі — свій Новий рік.', iconId: 'a' },
      { id: 't2', title: 'Феєрверк над фйордом', text: 'Салюти видно з усього міста.', iconId: 'b' },
      { id: 't3', title: 'Під північним сяйвом', text: 'У ясну погоду свято йде під сяйвом.', iconId: 'c' },
      { id: 't4', title: 'Четверта', text: 'не показуємо', iconId: 'd' },
    ],
  },
};
const MIDNIGHT = Date.parse('2027-01-01T02:00:00Z');
// 20:37 UTC, зсув −2 год → місцевий час 18:37.
const NOW = '2026-12-31T20:37:00Z';

afterEach(() => {
  useGuestStore.getState().setConsent({ facebookVideo: false });
});

describe('CountdownScene', () => {
  it('no-stream: назва, «Північ о … за вашим часом», місцевий час, примітка, 3 традиції', () => {
    const { container } = renderApp(<CountdownScene country={GREENLAND} cityName="Нуук" midnightMs={MIDNIGHT} offsetMinutes={-120} />, NOW);
    expect(screen.getByRole('heading', { level: 2, name: 'Гренландія · Нуук' })).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2027-01-01T02:00:00.000Z');
    expect(screen.getByText(/Північ о/)).toHaveTextContent(/Північ о \d{1,2}:\d{2} за вашим часом/);
    expect(screen.getByText('Місцевий час · 18:37')).toBeInTheDocument();
    expect(screen.getByText('сцена відліку · трансляції тут немає')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByText('Четверта')).toBeNull();
    expect(container.querySelector('[data-scene="no-stream"]')).not.toBeNull();
  });

  it('expected: «Трансляція почнеться сама, щойно з’явиться» і місцевий час в примітці', () => {
    renderApp(<CountdownScene country={GREENLAND} cityName="Нуук" midnightMs={MIDNIGHT} offsetMinutes={-120} variant="expected" />, NOW);
    expect(screen.getByText('Трансляція почнеться сама, щойно з’явиться')).toBeInTheDocument();
    expect(screen.getByText('сцена відліку · місцевий час 18:37')).toBeInTheDocument();
    expect(screen.queryByText(/Північ о/)).toBeNull();
  });

  it('власник 2026-11-11: великий відлік на сцені й єдина кнопка — «Сцена на весь екран»; фази півночі — у scene-midnight.test', () => {
    renderApp(<CountdownScene country={GREENLAND} cityName="Нуук" midnightMs={MIDNIGHT} offsetMinutes={-120} />, NOW);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Сцена на весь екран']);
    expect(document.querySelector('[data-scene-countdown]')).not.toBeNull();
    expect(document.querySelector('[role="timer"]')).toBeNull();
  });
});

function Sound() {
  return <span data-testid="sound">{useCoralWindowOpen() ? 'neutral' : 'coral'}</span>;
}

describe('FacebookConsentCard', () => {
  it('текст з макета, одна коралова «Дозволити»; звук нейтральний', () => {
    renderApp(
      <CoralProvider>
        <Sound />
        <FacebookConsentCard />
      </CoralProvider>,
    );
    expect(screen.getByText('Ця трансляція — з Facebook. Щоб її показати, дозволь cookies Facebook')).toBeInTheDocument();
    const allow = screen.getByRole('button', { name: 'Дозволити' });
    expect(allow).toHaveAttribute('data-variant', 'coral');
    expect(document.querySelectorAll('[data-variant="coral"]')).toHaveLength(1);
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
  });

  it('«Дозволити» пише guest.consent.facebookVideo і викликає onAllow', () => {
    const onAllow = vi.fn();
    renderApp(<FacebookConsentCard onAllow={onAllow} />);
    expect(useGuestStore.getState().consent.facebookVideo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Дозволити' }));
    expect(useGuestStore.getState().consent.facebookVideo).toBe(true);
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Дозволити' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Завантажуємо трансляцію');
  });
});
