// Вікно поясу під мапою (рішення власника 2026-11-03, дошка `Desk-Map-ZonePanel`): шапка зі стрілками, таймер, коротко,
// «Де дивитися», країни двома полицями (5 карток + решта за регіонами), стани «вже зустріли» й «без трансляцій».
import { fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildMapModel, type MapZone } from '@/components/live/MapModel';
import { ZonePanel } from '@/components/live/ZonePanel';
import { REGION_ORDER, regionOf } from '@/components/live/regions';
import uk from '@/messages/uk.json';
import { data } from '@/lib/data/load';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachine } from '@/lib/time/timeMachine';

const model = buildMapModel(data);
const zone = (id: string) => model.zones.find((z) => z.id === id)!;
const MIN = 60_000;

function wrap(ui: ReactElement, at: number) {
  return render(
    <NextIntlClientProvider locale="uk" messages={uk as never}>
      <TimeProvider source={new TimeMachine({ at, speed: 0 })}>{ui}</TimeProvider>
    </NextIntlClientProvider>,
  );
}

const panel = (z: MapZone, state: 'live' | 'next' | 'future' | 'past', at: number, phone = false, extra = {}) =>
  wrap(<ZonePanel zone={z} state={state} phone={phone} onSelect={() => undefined} onClose={() => undefined} {...extra} />, at);

describe('regionOf', () => {
  it('усі країни з даних мають регіон; Росія — Європа до UTC+4, далі Азія', () => {
    for (const c of data.countries) expect(regionOf(c.iso, 0), c.iso).not.toBeNull();
    expect(regionOf('RU', 120)).toBe('europe');
    expect(regionOf('RU', 720)).toBe('asia');
    expect(regionOf('EG', 120)).toBe('africa');
    expect(REGION_ORDER[0]).toBe('europe');
  });
});

describe('ZonePanel', () => {
  it('в ефірі: шапка, таймер з секундами, коротко, «Де дивитися» з «Дивитися», 5 карток і регіони', () => {
    const z = zone('utc+0200');
    const at = z.midnightMs - (39 * 60 + 30) * 1000;
    const { container, getByRole } = panel(z, 'live', at);
    expect(getByRole('heading', { name: 'UTC+2' })).toBeInTheDocument();
    expect(container.querySelector('[data-badge="live"]')).toHaveTextContent('В ефірі');
    expect(container.querySelector('[role="timer"]')).toHaveTextContent('00:39:30');
    expect(container).toHaveTextContent(`${z.countries.length}країн`);
    const cards = container.querySelectorAll('[data-stream-card]');
    expect(cards.length).toBe(z.streams!.length);
    expect(cards[0]).toHaveTextContent('Дивитися');
    // Найпопулярніші — 5 карток, без Росії й Білорусі.
    const cardsIso = [...container.querySelectorAll('[data-country-card]')].map((c) => c.getAttribute('data-country-card'));
    expect(cardsIso).toHaveLength(5);
    expect(cardsIso).not.toContain('RU');
    expect(cardsIso).not.toContain('BY');
    const regions = [...container.querySelectorAll('[data-region]')].map((r) => r.getAttribute('data-region'));
    expect(regions).toEqual(['europe', 'middleEast', 'africa']);
    // У регіонах — усі країни поясу, зокрема найпопулярніші.
    expect(container.querySelectorAll('[data-country-tile]')).toHaveLength(z.countries.length);
    expect(container.querySelector('[data-region="europe"] [data-country-tile="UA"]')).not.toBeNull();
  });

  it('стрілки ведуть до сусідніх поясів; × закриває', () => {
    const z = zone('utc+0200');
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { getByRole } = wrap(
      <ZonePanel zone={z} state="live" phone={false} prev={zone('utc+0300')} next={zone('utc+0100')} onSelect={onSelect} onClose={onClose} />,
      z.midnightMs - MIN,
    );
    fireEvent.click(getByRole('button', { name: 'Наступний пояс: UTC+1' }));
    expect(onSelect).toHaveBeenCalledWith('utc+0100');
    fireEvent.click(getByRole('button', { name: 'Попередній пояс: UTC+3' }));
    expect(onSelect).toHaveBeenCalledWith('utc+0300');
    fireEvent.click(getByRole('button', { name: 'Закрити' }));
    expect(onClose).toHaveBeenCalled();
    expect(getByRole('button', { name: 'Наступний пояс: UTC+1' })).toHaveTextContent('НаступнийUTC+1');
  });

  it('попереду: трансляції з часом початку й «Сторінка країни»', () => {
    const z = zone('utc+0100');
    const { container } = panel(z, 'next', z.midnightMs - 100 * MIN);
    const card = container.querySelector('[data-stream-card]')!;
    expect(card).toHaveTextContent('Сторінка країни');
    expect(card.querySelector('a')).toHaveAttribute('href', expect.stringMatching(/^\/country\//));
  });

  it('вже зустріли: замість таймера — «Новий рік зустріли · 7 год тому»; трансляції — у повторі', () => {
    const z = model.zones.find((k) => (k.streams?.length ?? 0) > 0 && k.id !== 'utc+0200')!;
    const { container, getByRole } = panel(z, 'past', z.midnightMs + 7 * 60 * MIN);
    expect(container.querySelector('[role="timer"]')).toBeNull();
    const time = container.querySelector('[data-zone-time="past"]')!;
    expect(time).toHaveTextContent('Новий рік зустріли');
    expect(time).toHaveTextContent('7 год тому');
    expect(getByRole('heading', { name: 'Переглянути в повторі' })).toBeInTheDocument();
    const card = container.querySelector('[data-stream-card]')!;
    expect(card).toHaveTextContent('Повтор');
    expect(card).toHaveTextContent('Дивитися повтор');
  });

  it('без трансляцій — один рядок замість карток', () => {
    const z = model.zones.find((k) => (k.streams?.length ?? 0) === 0)!;
    const { container } = panel(z, 'future', z.midnightMs - 5 * 60 * MIN);
    expect(container).toHaveTextContent('Трансляцій тут поки немає — лише відлік.');
  });

  it('телефон: дві групи регіонів одразу, решта — кнопкою «Ще …»', () => {
    const z = zone('utc+0200');
    const { container, getByRole } = panel(z, 'live', z.midnightMs - MIN, true);
    const btn = getByRole('button', { name: /Ще Африка · \d+/ });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.t2f-reveal[data-open="false"] [data-region="africa"]')).not.toBeNull();
    fireEvent.click(btn);
    expect(container.querySelector('.t2f-reveal[data-open="true"] [data-region="africa"]')).not.toBeNull();
  });
});
