import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { getData } from '@/lib/data/load';
import { scheduleNow } from '@/lib/live/homeData';
import { computeBroadcast } from '@/lib/player/BroadcastController';
import { renderApp } from './render';

const LONDON = Date.parse('2027-01-01T00:00:00Z');
const MIN = 60_000;

function renderAt(offsetMs: number, extra: { switched?: boolean } = {}) {
  const now = LONDON + offsetMs;
  const b = computeBroadcast(now);
  return renderApp(
    <main>
      <PlayerBlock
        mode="broadcast"
        ready
        phase={b.phase}
        current={b.current}
        next={b.next}
        airView={b.air?.view}
        timeZone="Europe/Kyiv"
        videoArea={b.air?.view === 'stream' ? 'video' : 'countdown-scene'}
        {...extra}
      />
    </main>,
    now,
  );
}

const row3 = (c: HTMLElement) => c.querySelector('[data-caption-row3]')?.textContent;
const timer = (c: HTMLElement) => c.querySelector('[data-caption-timer]');

describe('PlayerBlock (broadcast): фази підпису', () => {
  it('до півночі: відлік, «північ о 02:00 за вашим часом», «Обрати трансляцію ›»', () => {
    const { container } = renderAt(-(22 * MIN + 15_000));
    expect(timer(container)?.textContent).toMatch(/до півночі\s*00:22:15/);
    expect(row3(container)).toBe('Велика Британія · північ о 02:00 за вашим часом');
    expect(screen.getByRole('link', { name: /Лондон · Біг-Бен/ })).toHaveAttribute('href', expect.stringMatching(/^\/country\/velyka-brytaniia\/?$/));
    expect(screen.getByRole('link', { name: /Обрати трансляцію/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Увімкнути звук' })).toBeEnabled();
  });

  it('−5 хв: «Відео може запізнюватися на кілька секунд»', () => {
    renderAt(-3 * MIN);
    expect(screen.getByText('Відео може запізнюватися на кілька секунд')).toBeInTheDocument();
  });

  it('+15 с: без таймера, «Велика Британія зустріла Новий рік» (рід країни)', () => {
    const { container } = renderAt(20_000);
    expect(timer(container)).toBeNull();
    expect(row3(container)).toBe('Велика Британія зустріла Новий рік');
  });

  it('+14 хв: «далі через 0:59», «Далі: Азорські острови», «Лишитися тут ›»', () => {
    const { container } = renderAt(14 * MIN + 1_000);
    expect(timer(container)?.textContent).toMatch(/далі через\s*0:59/);
    expect(row3(container)).toBe('Далі: Азорські острови');
    expect(screen.getByRole('link', { name: /Лишитися тут/ })).toHaveAttribute('href', expect.stringMatching(/^\/country\/velyka-brytaniia\/?$/));
    expect(screen.queryByRole('link', { name: /Обрати трансляцію/ })).toBeNull();
  });

  it('+15 хв: ефір на Азорських островах, сцена відліку на місці плеєра, звук неактивний', () => {
    const { container } = renderAt(15 * MIN + 5_000);
    expect(row3(container)).toBe('Португалія · північ о 03:00 за вашим часом');
    expect(container.querySelector('[data-video-area="countdown-scene"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Увімкнути звук/ })).toBeDisabled();
  });

  it('перемикання джерела: «Перемкнули на іншу трансляцію з цього місця»', () => {
    renderAt(-10 * MIN, { switched: true });
    expect(screen.getByRole('status')).toHaveTextContent('Перемкнули на іншу трансляцію з цього місця');
  });
});

describe('scheduleNow (FR-014)', () => {
  const data = getData();
  const london = data.eventsById.get('evt_london_2027')!;

  it('подія з графіка в тому самому слоті, що й ефір — «Канарські острови»', () => {
    expect(scheduleNow(data, ['evt_canary_2027'], london)).toEqual({ place: 'Канарські острови', href: '/country/ispaniia/' });
  });

  it('порожній графік, сама подія ефіру або інший слот — нічого', () => {
    expect(scheduleNow(data, [], london)).toBeNull();
    expect(scheduleNow(data, ['evt_london_2027'], london)).toBeNull();
    expect(scheduleNow(data, ['evt_azores_2027'], london)).toBeNull();
  });
});
