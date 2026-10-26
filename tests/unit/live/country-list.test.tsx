// T093 (юніт, компонент): контракт DOM сторінки «Країни й міста» — групи, рядки, пошук, перемикач і фільтри.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { CountryList } from '@/components/live/CountryList';
import type { ZoneMapGeometry } from '@/components/live/MapModel';
import geometryJson from '@/data/zonemap.json';
import uk from '@/messages/uk.json';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachine } from '@/lib/time/timeMachine';

const messages = uk;

const geometry = geometryJson as unknown as ZoneMapGeometry;
const NOW = Date.parse('2026-12-31T23:50:00Z'); // UTC+0 «наживо», UTC−1 «далі»

function setup() {
  const machine = new TimeMachine({ at: NOW, speed: 0 });
  return render(
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider source={machine}>
        <CountryList geometry={geometry} />
      </TimeProvider>
    </NextIntlClientProvider>,
  );
}

vi.setConfig({ testTimeout: 60_000 });

const group = (c: HTMLElement, kind: string) => c.querySelector<HTMLElement>(`[data-zone-group="${kind}"]`);

describe('CountryList: контракт DOM', () => {
  it('один h1 «Країни й міста» і підзаголовок з датою', () => {
    setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Країни й міста' })).toBeInTheDocument();
    expect(screen.getByText(/^Пояси по черзі\. Час — за вашим часом \(.+\), зараз \d+ \p{L}+, \d{2}:\d{2}\.$/u)).toBeInTheDocument();
  });

  it('чотири групи з заголовками; живі й наступні розгорнуті з рядками, решта — згорнуті', () => {
    const { container } = setup();
    expect(group(container, 'live')!.querySelector('h2')!.textContent).toMatch(/^Зараз наживо/);
    expect(group(container, 'next')!.querySelector('h2')!.textContent).toMatch(/^Далі/);
    expect(group(container, 'later')!.querySelector('h2')!.textContent).toMatch(/^Ще попереду/);
    expect(group(container, 'met')!.querySelector('h2')!.textContent).toBe('Уже зустріли · 23 пояси');
    expect(group(container, 'live')!.querySelector('[data-country-row="GB"]')).not.toBeNull();
    expect(group(container, 'later')!.querySelector('[data-country-row]')).toBeNull();
    const toggle = within(group(container, 'met')!).getAllByRole('button')[0]!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(group(container, 'met')!.querySelector('[data-country-row]')).not.toBeNull();
  });

  it('рядок країни: data-country-row, data-status і посилання на сторінку країни з назвою', () => {
    const { container } = setup();
    const row = group(container, 'live')!.querySelector<HTMLElement>('[data-country-row="GB"]')!;
    expect(['live', 'expected', 'possible', 'countdown-only']).toContain(row.dataset.status);
    const link = within(row).getByRole('link');
    // Next Link у jsdom не знає про trailingSlash з next.config — слеш може бути відсутній.
    expect(link.getAttribute('href')).toMatch(/^\/country\/[^/]+\/?$/);
    expect(link).toHaveAccessibleName(/Велика Британія/);
    expect(row.textContent).toContain('Лондон · Вебкамера');
  });

  it('пошук «Бра» розкриває згорнуті групи й показує Бразилію; порожній результат — підказка', () => {
    const { container } = setup();
    const search = screen.getByRole('searchbox', { name: 'Знайти країну чи місто' });
    fireEvent.change(search, { target: { value: 'Бра' } });
    expect(group(container, 'later')!.querySelector('[data-country-row="BR"]')).not.toBeNull();
    fireEvent.change(search, { target: { value: 'qqqqzzzz' } });
    expect(screen.getByText('Нічого не знайшли — спробуй іншу назву')).toBeInTheDocument();
    expect(container.querySelector('[data-zone-group]')).toBeNull();
  });

  it('перемикач «Лише з трансляціями» ⇔ у фільтрах позначено лише «Наживо» і «Трансляція очікується»', () => {
    setup();
    const sw = screen.getByRole('switch', { name: 'Лише з трансляціями' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Фільтри' }));
    const dialog = screen.getByRole('dialog', { name: 'Фільтри' });
    const box = (name: RegExp) => within(dialog).getByRole('checkbox', { name });
    expect(box(/^Наживо/)).toBeChecked();
    expect(box(/^Лише відлік/)).toBeChecked();
    fireEvent.click(box(/^Трансляція можлива/));
    fireEvent.click(box(/^Лише відлік/));
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(box(/^Наживо/));
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: /^Фільтри · 1$/, hidden: true })).toBeInTheDocument();
  });

  it('0 статусів: «Показати 0 країн» неактивна, з’являється «Обери хоча б один статус»; «Скинути» повертає всі', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Фільтри' }));
    const dialog = screen.getByRole('dialog', { name: 'Фільтри' });
    for (const name of [/^Наживо/, /^Трансляція очікується/, /^Трансляція можлива/, /^Лише відлік/]) {
      fireEvent.click(within(dialog).getByRole('checkbox', { name }));
    }
    expect(within(dialog).getByRole('button', { name: 'Показати 0 країн' })).toBeDisabled();
    expect(within(dialog).getByText('Обери хоча б один статус')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скинути' }));
    expect(within(dialog).queryByText('Обери хоча б один статус')).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Показати \d+ країн/ })).toBeEnabled();
  });

  it('«У моєму графіку» не показується без паса й графіка', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'У моєму графіку' })).toBeNull();
  });
});
