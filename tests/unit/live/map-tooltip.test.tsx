// Плашки мапи при наведенні (рішення власника 2026-11-02, дошка `Desk-Map-Tips`): фази, тексти з родом, «ще N поясів»,
// прапори (до 5, країна гостя — перша), затримка появи, одна плашка (країна важливіша за пояс).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { buildMapModel, type MapZone, type ZoneMapGeometry } from '@/components/live/MapModel';
import { CountryTip, ZoneTip, orderTipFlags, tipPhase, viewerOffsetAt } from '@/components/live/MapTooltip';
import { ZoneMap } from '@/components/live/ZoneMap';
import geometryJson from '@/data/zonemap.json';
import uk from '@/messages/uk.json';
import { data } from '@/lib/data/load';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachine } from '@/lib/time/timeMachine';

const model = buildMapModel(data);
const geometry = geometryJson as unknown as ZoneMapGeometry;
const zone = (id: string) => model.zones.find((z) => z.id === id)!;
const MIN = 60_000;
// Під повним прогоном jsdom повільний: чекаємо довше за затримку появи (150 мс).
const WAIT = { timeout: 4000 };

function wrap(ui: ReactElement, at: number) {
  return render(
    <NextIntlClientProvider locale="uk" messages={uk as never}>
      <TimeProvider source={new TimeMachine({ at, speed: 0 })}>{ui}</TimeProvider>
    </NextIntlClientProvider>,
  );
}

describe('tipPhase', () => {
  const mid = Date.parse('2026-12-31T22:00:00Z');
  it('в ефірі до півночі й після — різні фази; через 15 хв — вже зустріли', () => {
    expect(tipPhase('live', mid, mid - 40 * MIN)).toBe('liveBefore');
    expect(tipPhase('live', mid, mid + MIN)).toBe('liveAfter');
    expect(tipPhase('past', mid, mid + 20 * MIN)).toBe('past');
    expect(tipPhase('future', mid, mid - 11 * 60 * MIN)).toBe('future');
    expect(tipPhase('next', mid, mid - 90 * MIN)).toBe('next');
  });
});

describe('viewerOffsetAt', () => {
  it('зсув пристрою від UTC у хвилинах', () => {
    const t = Date.parse('2026-12-31T22:00:00Z');
    expect(viewerOffsetAt(t, 'Europe/Kyiv')).toBe(120);
    expect(viewerOffsetAt(t, 'America/New_York')).toBe(-300);
    expect(viewerOffsetAt(t, 'Asia/Kathmandu')).toBe(345);
    expect(viewerOffsetAt(t, 'UTC')).toBe(0);
  });
});

describe('orderTipFlags', () => {
  it('за популярністю, країна гостя — першою', () => {
    const z = zone('utc+0200');
    expect(orderTipFlags(z.countries, null)[0]!.iso).toBe(z.countries[0]!.iso);
    const egFirst = orderTipFlags(z.countries, 'EG');
    expect(egFirst[0]!.iso).toBe('EG');
    expect(egFirst).toHaveLength(z.countries.length);
  });
});

describe('ZoneTip', () => {
  it('попереду: «Північ через 11 год», 5 прапорців і «+N», трансляції', () => {
    const z = zone('utc-0500');
    const now = z.midnightMs - 11 * 60 * MIN;
    const { container } = wrap(<ZoneTip zone={z} state="future" now={now} />, now);
    expect(container).toHaveTextContent('UTC−5');
    expect(container).toHaveTextContent('Північ через 11 год');
    expect(container).toHaveTextContent('за вашим часом');
    expect(container.querySelector('[data-tip-flags]')).toHaveAttribute('data-tip-flags', '5');
    expect(container).toHaveTextContent(`+${z.countries.length - 5}`);
    if (z.streamCount) expect(container.querySelector('[data-tip-streams]')).not.toBeNull();
  });

  it('в ефірі до півночі й щойно після; «ваш пояс» — коли зсув пристрою збігається', () => {
    const z = zone('utc+0200');
    const before = z.midnightMs - 40 * MIN;
    const a = wrap(<ZoneTip zone={z} state="live" now={before} />, before);
    expect(a.container).toHaveTextContent('В ефірі · північ через 40 хв');
    const own = viewerOffsetAt(z.midnightMs) === z.offsetMinutes;
    expect(a.container.querySelector('[data-tip-own]') !== null).toBe(own);
    a.unmount();
    const after = z.midnightMs + MIN;
    const b = wrap(<ZoneTip zone={z} state="live" now={after} />, after);
    expect(b.container).toHaveTextContent('Північ щойно настала');
  });

  it('вже зустріли: скільки тому, без трансляцій', () => {
    const z = zone('utc+0900');
    const now = z.midnightMs + 7 * 60 * MIN;
    const { container } = wrap(<ZoneTip zone={z} state="past" now={now} />, now);
    expect(container).toHaveTextContent('Зустріли 7 год тому');
    expect(container.querySelector('[data-tip-streams]')).toBeNull();
  });
});

describe('CountryTip', () => {
  const country = (z: MapZone, iso: string) => z.countries.find((c) => c.iso === iso)!;

  it('один пояс, в ефірі до півночі, головне місто з трансляцією', () => {
    const z = zone('utc+0200');
    const now = z.midnightMs - 40 * MIN;
    const ua = country(z, 'UA');
    const { container } = wrap(<CountryTip zone={z} country={ua} state="live" now={now} zoneCount={1} />, now);
    expect(container).toHaveTextContent('Україна');
    expect(container).toHaveTextContent('UTC+2');
    expect(container).not.toHaveTextContent('ще');
    expect(container).toHaveTextContent('Північ через 40 хв');
    expect(container).toHaveTextContent('Київ · наживо');
  });

  it('кілька поясів і рід: «ще 5 поясів», «Зустрічають», «Зустріла»', () => {
    const z5 = zone('utc-0500');
    const after = z5.midnightMs + MIN;
    const us = wrap(<CountryTip zone={z5} country={country(z5, 'US')} state="live" now={after} zoneCount={6} />, after);
    expect(us.container).toHaveTextContent('UTC−5 · ще 5 поясів');
    expect(us.container).toHaveTextContent('Зустрічають Новий рік');
    us.unmount();
    const z3 = zone('utc+0300');
    const past = z3.midnightMs + 150 * MIN;
    const ru = wrap(<CountryTip zone={z3} country={country(z3, 'RU')} state="past" now={past} zoneCount={11} />, past);
    expect(ru.container).toHaveTextContent('UTC+3 · ще 10 поясів');
    expect(ru.container).toHaveTextContent('Зустріла 2 год 30 хв тому');
    expect(ru.container.querySelector('[data-tip-city]')).toBeNull();
  });

  it('модель: рід і головне місто з трансляцією з даних', () => {
    expect(country(zone('utc+0200'), 'UA')).toMatchObject({ gender: 'f', mainCity: 'Київ' });
    expect(country(zone('utc-0500'), 'US').gender).toBe('pl');
    expect(zone('utc+0200').streamCount).toBeGreaterThan(0);
  });
});

describe('ZoneMap: плашка при наведенні (десктоп)', () => {
  const NOW = Date.parse('2026-12-31T21:20:00Z');
  const setup = () =>
    wrap(<ZoneMap zones={model.zones} cities={model.cities} geometry={geometry} layout="desktop" />, NOW);

  it('смуга поясу → плашка поясу через затримку; країна витісняє пояс; немає курсора — немає плашки', { timeout: 20_000 }, async () => {
    const { container } = setup();
    const band = container.querySelector('[data-zone-band="utc-0500"]')!;
    fireEvent.pointerOver(band);
    expect(container.querySelector('[data-zone-map-tip]')).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-zone-map-tip="zone"]')).not.toBeNull(), WAIT);
    expect(container.querySelector('[data-zone-map-tip]')).toHaveTextContent('UTC−5');
    fireEvent.pointerOut(band);
    const ua = container.querySelector('g[data-zone="utc+0200"] path.t2f-zone-land[data-iso="UA"]')!;
    fireEvent.pointerOver(ua);
    await waitFor(() => expect(container.querySelector('[data-zone-map-tip="country"]')).not.toBeNull(), WAIT);
    expect(container.querySelectorAll('[data-zone-map-tip]')).toHaveLength(1);
    expect(screen.getByText('Україна')).toBeInTheDocument();
    fireEvent.pointerOut(ua);
    await waitFor(() => expect(container.querySelector('[data-zone-map-tip]')).toBeNull(), WAIT);
  });

  it('точки міст на десктопі — 20 px (size-5), не 44', () => {
    const { container } = setup();
    const kyiv = container.querySelector('[data-city="kyiv"]')!;
    expect(kyiv).toHaveClass('size-5');
    expect(kyiv).not.toHaveClass('size-11');
  });
});
