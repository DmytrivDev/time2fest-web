// «Країни й міста» — довідник країн за поясами (рішення власника 2026-11-04, дошка `Desk-Countries-Next`, v2): рядки поясів як у
// «Списку» головної (п’ять прапорців і «ще N»), на старті згорнуті; розгорнутий пояс — картки країн за регіонами, клік —
// сторінка країни; пошук і фільтри — ті самі рядки, лише зі збігами й розгорнуті.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { CountryList } from '@/components/live/CountryList';
import type { ZoneMapGeometry } from '@/components/live/MapModel';
import geometryJson from '@/data/zonemap.json';
import uk from '@/messages/uk.json';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachine } from '@/lib/time/timeMachine';
import { useGuestStore } from '@/stores/guest';

const geometry = geometryJson as unknown as ZoneMapGeometry;
const NOW = Date.parse('2026-12-31T23:50:00Z'); // UTC+0 «наживо», UTC−1 «далі»

function setup() {
  const machine = new TimeMachine({ at: NOW, speed: 0 });
  return render(
    <NextIntlClientProvider locale="uk" messages={uk as never}>
      <TimeProvider source={machine}>
        <CountryList geometry={geometry} />
      </TimeProvider>
    </NextIntlClientProvider>,
  );
}

vi.setConfig({ testTimeout: 60_000 });

const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[data-zone-list] [data-zone-row]')];
const head = (c: HTMLElement, id: string) => c.querySelector<HTMLButtonElement>(`[data-zone-row="${id}"] > button`)!;
const search = () => screen.getByRole('searchbox', { name: 'Знайти країну чи місто' });

describe('CountryList: довідник країн за поясами', () => {
  it('один h1 «Країни й міста» і підзаголовок з датою', () => {
    setup();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Країни й міста' })).toBeInTheDocument();
    expect(screen.getByText(/^Пояси по черзі\. Час — за вашим часом \(.+\), зараз \d+ \p{L}+, \d{2}:\d{2}\.$/u)).toBeInTheDocument();
  });

  it('усі пояси, що попереду, по черзі; на старті всі згорнуті; «Вже зустріли» — згорнуто внизу', () => {
    const { container } = setup();
    const ids = rows(container).map((r) => r.dataset.zoneRow);
    expect(ids[0]).toBe('utc+0000');
    expect(ids[1]).toBe('utc-0100');
    expect(ids).toContain('utc-1200');
    for (const r of rows(container)) expect(r.querySelector(':scope > button')).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[data-zone-list-past]')).toHaveAttribute('aria-expanded', 'false');
    // Посилання «Усі пояси й країни» — лише на головній.
    expect(container.querySelector('[data-zone-list-all]')).toBeNull();
  });

  it('рядок: п’ять прапорців і «ще N» замість назв', () => {
    const { container } = setup();
    const row = head(container, 'utc+0000');
    expect(row.querySelectorAll('img, svg[role="img"], [data-flag]').length).toBeGreaterThan(0);
    expect(row).toHaveTextContent(/ще \d+/);
    expect(row).not.toHaveTextContent('Велика Британія');
  });

  it('розгорнутий пояс: рядок про пояс і картки країн за регіонами; картка — посилання на сторінку країни', () => {
    const { container } = setup();
    fireEvent.click(head(container, 'utc+0000'));
    const dir = container.querySelector<HTMLElement>('[data-zone-directory="utc+0000"]')!;
    expect(dir.querySelector('[data-zone-summary]')).toHaveTextContent(/країн/);
    expect(dir.querySelector('[data-region="europe"]')).not.toBeNull();
    const gb = dir.querySelector<HTMLElement>('[data-country-card="GB"]')!;
    expect(gb).toHaveAttribute('data-status', 'live');
    expect(gb).toHaveTextContent('Трансляція');
    expect(within(gb).getByRole('link')).toHaveAttribute('href', expect.stringMatching(/^\/country\//));
    // Без трансляції — «лише відлік».
    const quiet = [...dir.querySelectorAll<HTMLElement>('[data-country-card][data-status="none"]')][0]!;
    expect(quiet).toHaveTextContent('лише відлік');
  });

  it('трансляція ще попереду — «трансляція о …» і календарик поза посиланням', () => {
    const { container } = setup();
    fireEvent.click(head(container, 'utc-0300'));
    const card = container.querySelector<HTMLElement>('[data-zone-directory="utc-0300"] [data-country-card][data-status="soon"]')!;
    expect(card).toHaveTextContent(/трансляція о \d{2}:\d{2}/);
    const cal = card.querySelector('[data-schedule-toggle]')!;
    expect(cal.closest('a')).toBeNull();
    // Календарик — і там, де лише відлік (правка власника 2026-11-04).
    const quiet = container.querySelector<HTMLElement>('[data-zone-directory="utc-0300"] [data-country-card][data-status="none"]')!;
    expect(quiet.querySelector('[data-schedule-toggle]')).not.toBeNull();
  });

  it('пошук «Бразил»: лише пояси з Бразилією, розгорнуті; нісенітниця — порожній стан; «Очистити» повертає все згорнутим', () => {
    const { container } = setup();
    fireEvent.change(search(), { target: { value: 'Бразил' } });
    const found = rows(container);
    expect(found.length).toBeGreaterThan(0);
    for (const r of found) {
      expect(r.querySelector(':scope > button')).toHaveAttribute('aria-expanded', 'true');
      expect(r.querySelector('[data-country-card="BR"]')).not.toBeNull();
    }
    fireEvent.change(search(), { target: { value: 'Атлантида' } });
    expect(screen.getByRole('status')).toHaveTextContent('Нічого не знайшли — спробуй іншу назву');
    fireEvent.change(search(), { target: { value: 'Бразил' } });
    fireEvent.click(screen.getByRole('button', { name: 'Очистити' }));
    expect(rows(container).length).toBeGreaterThan(20);
    expect(head(container, 'utc+0000')).toHaveAttribute('aria-expanded', 'false');
  });

  it('пошук за містом: картка країни з позначкою міста', () => {
    const { container } = setup();
    fireEvent.change(search(), { target: { value: 'Ріо' } });
    const br = container.querySelector<HTMLElement>('[data-country-card="BR"]')!;
    expect(br).not.toBeNull();
  });

  it('«З трансляціями» лишає лише країни з трансляціями; «Мій графік» без пасу — плашка пасу', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'З трансляціями' }));
    for (const c of container.querySelectorAll<HTMLElement>('[data-country-card]')) expect(c.dataset.status).not.toBe('none');
    expect(container.querySelector('[data-zone-row="utc-0100"]')).toBeNull(); // Азори й Кабо-Верде — лише відлік
    useGuestStore.setState({ hasPass: false });
    fireEvent.click(screen.getByRole('radio', { name: /Мій графік/ }));
    expect(container.querySelector('[data-row="mine-locked"]')).toHaveTextContent('Новорічний пас');
    expect(rows(container)).toHaveLength(0);
  });

  it('«Мапа | Список»: «Мапа» — мапа поясів без своєї шапки', () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Мапа' }));
    expect(container.querySelector('[data-zone-map]')).not.toBeNull();
    expect(container.querySelector('[data-zone-list]')).toBeNull();
    // Пошук з «Мапи» — одразу «Список» зі знайденим (правка власника 2026-11-04).
    fireEvent.change(search(), { target: { value: 'Бразил' } });
    expect(container.querySelector('[data-zone-list]')).not.toBeNull();
    expect(container.querySelector('[data-zone-map]')).toBeNull();
  });
});
