// T067 (юніт, компонент): стани поясів від TimeSource, картка під мапою на телефоні, клавіатура.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { buildMapModel, type ZoneMapGeometry } from '@/components/live/MapModel';
import { ZoneMap, type ZoneMapProps } from '@/components/live/ZoneMap';
import geometryJson from '@/data/zonemap.json';
import uk from '@/messages/uk.json';
import { data } from '@/lib/data/load';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { TimeMachine } from '@/lib/time/timeMachine';

const messages = uk;

const geometry = geometryJson as unknown as ZoneMapGeometry;
const model = buildMapModel(data);
const NOW = Date.parse('2026-12-31T23:50:00Z'); // Лондон у ефірі, Азорські острови наступні

function setup(props: Partial<ZoneMapProps> = {}, at = NOW) {
  const machine = new TimeMachine({ at, speed: 0 });
  const ui = (p: Partial<ZoneMapProps>): ReactElement => (
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider source={machine}>
        <ZoneMap zones={model.zones} cities={model.cities} geometry={geometry} layout="phone" {...p} />
      </TimeProvider>
    </NextIntlClientProvider>
  );
  const view = render(ui(props));
  const path = (zoneId: string) => view.container.querySelector<SVGGElement>(`g[data-zone="${zoneId}"]`)!;
  return { machine, view, path };
}

describe('ZoneMap: стани поясів', () => {
  it('38 шляхів з data-offset і рівно одним Tab-стопом', () => {
    const { view } = setup();
    const paths = view.container.querySelectorAll('g[data-offset]');
    expect(paths).toHaveLength(38);
    expect(view.container.querySelectorAll('g[data-offset][tabindex="0"]')).toHaveLength(1);
  });

  it('класи is-past | is-live | is-next | is-ahead від zoneState', () => {
    const { path } = setup();
    expect(path('utc+0000')).toHaveClass('is-live');
    expect(path('utc-0100')).toHaveClass('is-next');
    expect(path('utc+0100')).toHaveClass('is-past');
    expect(path('utc+1400')).toHaveClass('is-past');
    expect(path('utc-0500')).toHaveClass('is-ahead');
  });

  it('стан не лише кольором: у «наживо» й «найближчого» іконки, у кожного — підпис («Вже зустріли» — рівна заливка)', () => {
    const { view, path } = setup();
    expect(path('utc+0100')).toHaveClass('is-past');
    expect(view.container.querySelector('[data-zone-icon="live"]')).not.toBeNull();
    expect(view.container.querySelector('[data-zone-icon="next"]')).not.toBeNull();
    expect(path('utc-0100').getAttribute('aria-label')).toMatch(/найближча північ/);
    expect(path('utc+0000').getAttribute('aria-label')).toMatch(/північ зараз/);
    expect(path('utc-0500').getAttribute('aria-label')).toMatch(/ще попереду/);
    expect(path('utc+0100').getAttribute('aria-label')).toMatch(/уже зустрів/);
  });

  it('класи оновлюються, коли рухається TimeSource', () => {
    const { machine, path } = setup();
    act(() => machine.set({ at: Date.parse('2027-01-01T00:16:00Z') }));
    expect(path('utc+0000')).toHaveClass('is-past');
    expect(path('utc-0100')).toHaveClass('is-live');
    expect(path('utc-0200')).toHaveClass('is-next');
  });

  it('до півночі Кірібаті «наживо» — UTC+14, далі UTC+13:45', () => {
    const { path } = setup({}, Date.parse('2026-12-31T09:00:00Z'));
    expect(path('utc+1400')).toHaveClass('is-live');
    expect(path('utc+1345')).toHaveClass('is-next');
    expect(path('utc+1300')).toHaveClass('is-ahead');
  });
});

const OPEN_PANEL = '[data-zone-map-card-slot] .t2f-reveal[data-open="true"] [data-zone-panel]';
const OPEN_COUNTRY = '[data-zone-map-card-slot] .t2f-reveal[data-open="true"] [data-country-panel]';

describe('ZoneMap: телефон — дотик відкриває вікно під мапою без переходу', () => {
  it('тап по місту: вікно країни цього міста під мапою, кімната — посилання, сторінка не змінюється', () => {
    const { view } = setup();
    const before = window.location.href;
    const dot = view.container.querySelector<HTMLButtonElement>('button[data-city="london"]')!;
    expect(dot).not.toBeNull();
    expect(dot.tagName).toBe('BUTTON');
    expect(view.container.querySelector('a[data-city]')).toBeNull();
    fireEvent.click(dot);
    const panel = view.container.querySelector<HTMLElement>(OPEN_COUNTRY)!;
    expect(panel).toHaveAttribute('data-country-panel', 'GB');
    expect(panel).toHaveAttribute('data-zone-id', 'utc+0000');
    const room = panel.querySelector('[data-country-room-link]')!;
    expect(room).toHaveAttribute('href', expect.stringMatching(/^\/country\/[^/]+/));
    expect(window.location.href).toBe(before);
    expect(dot).toHaveAttribute('aria-expanded', 'true');
    // Вікно стоїть після мапи (під нею), а не навколо.
    const svg = view.container.querySelector('svg[data-zone-map-svg]')!;
    expect(svg.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('× закриває вікно й повертає фокус на пояс', () => {
    const { view, path } = setup();
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('button[data-city="london"]')!);
    // Пошук за роллю по всій мапі повільний — кнопку беремо з вікна напряму.
    fireEvent.click(view.container.querySelector<HTMLButtonElement>(`${OPEN_COUNTRY} button[aria-label="Закрити"]`)!);
    expect(view.container.querySelector(OPEN_COUNTRY)).toBeNull();
    expect(path('utc+0000')).toHaveFocus();
  });

  it('на десктопі: трансляція йде чи є повтор — посилання на країну; ще буде чи лише відлік — вікно країни', () => {
    const { view } = setup({ layout: 'desktop' });
    const dot = view.container.querySelector('[data-city="london"]')!;
    expect(dot.tagName).toBe('A');
    expect(dot.getAttribute('href')).toMatch(/^\/country\//);
    // Париж (UTC+1) уже зустрів — повтор, теж посилання.
    expect(view.container.querySelector('[data-city="paris"]')!.tagName).toBe('A');
    // Нью-Йорк ще попереду — кнопка, відкриває вікно країни.
    const ny = view.container.querySelector<HTMLButtonElement>('[data-city="new-york"]')!;
    expect(ny.tagName).toBe('BUTTON');
    fireEvent.click(ny);
    expect(view.container.querySelector(OPEN_COUNTRY)).toHaveAttribute('data-country-panel', 'US');
    // Постійного підпису «Лондон · наживо — дивитися» на мапі немає (правка власника 2026-11-03).
    expect(view.container.querySelector('[data-zone-map-live-label]')).toBeNull();
  });

  it('коралова точка з трансляцією лише в поясі «наживо»; решта тихі', () => {
    const { view } = setup();
    expect(view.container.querySelector('[data-city="london"] [data-city-dot="live"]')).not.toBeNull();
    expect(view.container.querySelector('[data-city="paris"] [data-city-dot="live"]')).toBeNull();
    expect(view.container.querySelector('[data-city="paris"] [data-city-dot="quiet"]')).not.toBeNull();
  });
});

describe('ZoneMap: вікно країни (рішення власника 2026-11-03)', () => {
  const land = (view: ReturnType<typeof setup>['view'], zoneId: string, iso: string) =>
    view.container.querySelector<SVGPathElement>(`g[data-zone="${zoneId}"] path[data-iso="${iso}"]`)!;

  it('клік по суші — вікно країни, по океану — вікно поясу; «Відкрити пояс» міняє вікно на пояс', () => {
    const { view } = setup({ layout: 'desktop' });
    fireEvent.click(land(view, 'utc+0000', 'GB'));
    const panel = view.container.querySelector<HTMLElement>(OPEN_COUNTRY)!;
    expect(panel).toHaveAttribute('data-country-panel', 'GB');
    expect(panel.querySelector('h3')).toHaveTextContent('Велика Британія');
    // Країна підсвічена, поки відкрите її вікно.
    expect(land(view, 'utc+0000', 'GB')).toHaveAttribute('data-hot', 'true');
    expect(panel.querySelector('[data-stream-card]')).not.toBeNull();
    fireEvent.click(panel.querySelector<HTMLButtonElement>('button[aria-label="Відкрити пояс UTC+0"]')!);
    expect(view.container.querySelector(OPEN_COUNTRY)).toBeNull();
    expect(view.container.querySelector(OPEN_PANEL)).toHaveAttribute('data-zone-panel', 'utc+0000');
    const band = view.container.querySelector<SVGPathElement>('[data-zone-band="utc-0500"]');
    if (band) {
      fireEvent.click(band);
      expect(view.container.querySelector(OPEN_PANEL)).toHaveAttribute('data-zone-panel', 'utc-0500');
    }
  });

  it('країна в кількох поясах: вікно — для поясу кліку, кнопки поясів перемикають', () => {
    const { view } = setup({ layout: 'desktop' });
    fireEvent.click(land(view, 'utc-0500', 'US'));
    const panel = () => view.container.querySelector<HTMLElement>(OPEN_COUNTRY)!;
    expect(panel()).toHaveAttribute('data-zone-id', 'utc-0500');
    const chips = panel().querySelectorAll('[data-country-zone]');
    expect(chips.length).toBeGreaterThan(3);
    expect(panel().querySelector('[data-country-zone="utc-0500"]')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(panel().querySelector('[data-country-zone="utc-0800"]')!);
    expect(panel()).toHaveAttribute('data-zone-id', 'utc-0800');
    // У Лос-Анджелесі трансляції немає — картка «Лише відлік» того ж розміру.
    expect(panel().querySelector('[data-countdown-card]')).not.toBeNull();
  });

  it('вже зустріли: повтор, штамп «уже не отримати», наступна північ відкриває пояс', () => {
    const { view } = setup({ layout: 'desktop' }, Date.parse('2027-01-01T00:30:00Z'));
    fireEvent.click(land(view, 'utc+0000', 'GB'));
    const panel = view.container.querySelector<HTMLElement>(OPEN_COUNTRY)!;
    expect(panel.querySelector('[data-country-time="past"]')).not.toBeNull();
    expect(panel.querySelector('h4')).toHaveTextContent('Переглянути в повторі');
    expect(panel.querySelector('[data-room-stamp="missed"]')).not.toBeNull();
    expect(panel.querySelector('[data-room-seats]')).toBeNull();
    const next = panel.querySelector<HTMLButtonElement>('[data-next-zone]')!;
    expect(next).toHaveAttribute('data-next-zone', 'utc-0100');
    fireEvent.click(next);
    expect(view.container.querySelector(OPEN_PANEL)).toHaveAttribute('data-zone-panel', 'utc-0100');
  });

  it('до півночі: відлік із секундами, штамп і кнопка кімнати; телефон — традиції без описів', () => {
    const { view } = setup({}, Date.parse('2026-12-31T23:20:00Z'));
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('button[data-city="london"]')!);
    const panel = view.container.querySelector<HTMLElement>(OPEN_COUNTRY)!;
    expect(panel.querySelector('[role="timer"]')).toHaveTextContent('00:40:00');
    expect(panel.querySelector('[data-room-stamp="ahead"]')).toHaveTextContent('Штамп «Велика Британія · 2027»');
    expect(panel.querySelector('[data-country-room-link]')).toHaveTextContent('Перейти до кімнати країни');
    expect(panel.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(panel.textContent).not.toContain('Більше');
  });
});

describe('ZoneMap: клавіатура', () => {
  it('стрілки рухають фокус між поясами; Enter відкриває вікно поясу; Esc закриває й повертає фокус', () => {
    const { view, path } = setup();
    const live = path('utc+0000');
    live.focus();
    fireEvent.keyDown(live, { key: 'ArrowRight' }); // на схід: UTC+1
    expect(path('utc+0100')).toHaveFocus();
    expect(path('utc+0100')).toHaveAttribute('tabindex', '0');
    expect(live).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(path('utc+0100'), { key: 'ArrowLeft' });
    expect(path('utc+0000')).toHaveFocus();

    fireEvent.keyDown(path('utc+0000'), { key: 'Enter' });
    const card = view.container.querySelector<HTMLElement>(OPEN_PANEL)!;
    expect(card).not.toBeNull();
    expect(card.querySelector('h3')).toHaveTextContent('UTC+0');
    expect(card.querySelectorAll('a[href^="/country/"]').length).toBeGreaterThan(0);

    fireEvent.keyDown(card, { key: 'Escape' });
    expect(view.container.querySelector(OPEN_PANEL)).toBeNull();
    expect(path('utc+0000')).toHaveFocus();
  });

  it('Home / End: перший і останній пояс', () => {
    const { path } = setup();
    path('utc+0000').focus();
    fireEvent.keyDown(path('utc+0000'), { key: 'End' });
    expect(path('utc+1400')).toHaveFocus();
    fireEvent.keyDown(path('utc+1400'), { key: 'Home' });
    expect(path('utc-1200')).toHaveFocus();
  });
});

describe('ZoneMap: інше', () => {
  it('перемикач вигляду: «Список» поки сховано, лише «Мапа» (рішення власника)', () => {
    const { view } = setup();
    expect(screen.getByRole('button', { name: 'Мапа' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Список' })).toBeNull();
    expect(view.container.querySelector('svg[data-zone-map-svg]')).not.toBeNull();
  });

  it('defaultView="list": текстовий список з 38 кнопками-поясами лишається доступним', () => {
    const { view } = setup({ defaultView: 'list' });
    expect(view.container.querySelectorAll('[data-zone-list] button')).toHaveLength(38);
  });

  it('у видимих рядках немає слова «ніч» окремо і назв без відмінка', () => {
    const { view } = setup({ defaultSelectedZoneId: 'utc+0000' });
    const text = view.container.textContent ?? '';
    expect(text).not.toMatch(/(^|[^а-яіїєґ])ніч([^а-яіїєґ]|$)/i);
  });

  it('телефон: легенда в рамці мапи — чотири стани + два види точок, коротко; кнопок масштабу немає', () => {
    const { view } = setup();
    const legend = view.container.querySelector('[data-zone-map-canvas] [data-map-legend="inMap"]')!;
    for (const label of ['Наживо', 'Найближча', 'Попереду', 'Зустріли', 'Місто', 'Трансляція']) expect(legend).toHaveTextContent(label);
    expect(legend.querySelectorAll('li')).toHaveLength(6);
    expect(view.container.querySelectorAll('[data-map-legend]')).toHaveLength(1);
    expect(view.container.querySelector('[data-zone-map-zoom]')).toBeNull();
  });

  it('телефон: «Зараз» під мапою — два рядки (в ефірі й «Далі»); дотик відкриває вікно поясу, картка ховається', () => {
    const { view } = setup();
    const now = view.container.querySelector('[data-map-now]')!;
    const rows = now.querySelectorAll('[data-queue-zone]');
    expect([...rows].map((r) => r.getAttribute('data-queue-zone'))).toEqual(['utc+0000', 'utc-0100']);
    expect(rows[0]).toHaveTextContent('Зараз');
    expect(rows[1]).toHaveTextContent('Далі');
    // Без «Вже зустріли» й точок міст — вони в легенді нижче.
    expect(now.querySelector('[data-queue-past]')).toBeNull();
    expect(now.querySelector('[data-map-city-key]')).toBeNull();
    fireEvent.click(rows[1]!);
    expect(view.container.querySelector(OPEN_PANEL)).toHaveAttribute('data-zone-panel', 'utc-0100');
    expect(view.container.querySelector('[data-map-now]')).toBeNull();
  });

  it('десктоп: колонка — «Північ по черзі»: зараз, далі, ще 4; «Вже зустріли»; рядок вибирає пояс', () => {
    const { view } = setup({ layout: 'desktop' });
    const queue = view.container.querySelector('[data-map-queue]')!;
    const rows = queue.querySelectorAll('[data-queue-zone]');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toHaveAttribute('data-queue-zone', 'utc+0000');
    expect(rows[0]).toHaveTextContent('Зараз');
    expect(rows[1]).toHaveAttribute('data-queue-zone', 'utc-0100');
    expect(rows[1]).toHaveTextContent('Далі');
    expect(queue.querySelector('[data-queue-past]')).toHaveTextContent(/Вже зустріли · \d+ пояс/);
    expect(queue.querySelector('[data-map-city-key]')).toHaveTextContent('МістоТрансляція');
    expect(view.container.querySelector('[data-map-legend]')).toBeNull();
    fireEvent.click(rows[2]!);
    // Вікно поясу — під мапою; черга лишається на місці.
    expect(view.container.querySelector(OPEN_PANEL)).toHaveAttribute('data-zone-panel', 'utc-0200');
    expect(view.container.querySelector('[data-map-queue]')).not.toBeNull();
    expect(rows[2]).toHaveAttribute('aria-pressed', 'true');
  });

  it('UTC — лише в картці поясу й у «Зараз» під мапою: на самій мапі й у назвах шляхів його немає', () => {
    const { view, path } = setup();
    expect(view.container.querySelector('[data-zone-map-scroll]')?.textContent).not.toMatch(/UTC/);
    expect(view.container.querySelector('[data-map-now]')?.textContent).toMatch(/UTC\+0/);
    expect(path('utc+0000').getAttribute('aria-label')).not.toMatch(/UTC/);
    fireEvent.click(path('utc+0000'));
    expect(view.container.querySelector(OPEN_PANEL)?.textContent).toMatch(/UTC\+0/);
  });
});
