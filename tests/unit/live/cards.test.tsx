import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CelebrationsSlider } from '@/components/live/CelebrationsSlider';
import { CountryChips } from '@/components/live/CountryChips';
import { EventCard } from '@/components/live/EventCard';
import { HowToCard } from '@/components/live/HowToCard';
import { NowNext } from '@/components/live/NowNext';
import { FestProgress } from '@/components/live/Progress';
import { AZORES, CAPE_VERDE, LONDON, PARIS, STRIP, TRADITIONS, ZONE_COUNTRIES } from '../../../stories/_support/liveFixtures';
import { renderWithApp } from '../_support/render';

// Embla у jsdom потребує matchMedia / ResizeObserver / IntersectionObserver.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal('ResizeObserver', NoopObserver);
vi.stubGlobal('IntersectionObserver', NoopObserver);
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
  onchange: null,
})) as unknown as typeof window.matchMedia;

describe('EventCard', () => {
  it('наживо: «В ефірі», «Наживо», тип святкування; відліку немає', () => {
    renderWithApp(<EventCard {...LONDON} status="live" onToggleSchedule={() => undefined} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText('В ефірі')).toBeInTheDocument();
    expect(within(card).getByText('Наживо')).toBeInTheDocument();
    expect(within(card).getByText('Головне святкування')).toBeInTheDocument();
    expect(within(card).getByText('за вашим часом')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/gb');
    expect(within(card).getByRole('link')).toHaveAttribute('aria-current', 'true');
  });

  it('минула: «північ була … тому», кнопка графіка неактивна з причиною в назві', () => {
    renderWithApp(<EventCard {...PARIS} status="recording" onToggleSchedule={() => undefined} />);
    expect(screen.getByText(/північ була 50 хв тому/)).toBeInTheDocument();
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName(/північ уже минула/);
    expect(screen.queryByText('В ефірі')).toBeNull();
  });

  it('кнопка графіка інертна без обробника; з обробником перемикає', () => {
    const { unmount } = renderWithApp(<EventCard {...AZORES} status="soon" />);
    expect(screen.getByRole('button')).toBeDisabled();
    unmount();

    const onToggle = vi.fn();
    renderWithApp(<EventCard {...AZORES} status="soon" onToggleSchedule={onToggle} />);
    const button = screen.getByRole('button', { name: 'Додати в графік: Азорські острови' });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(AZORES.id, true);
  });

  it('у графіку й ваша північ: дві позначки, назва кнопки «Прибрати з графіка»', () => {
    renderWithApp(<EventCard {...AZORES} status="soon" inSchedule isOwnMidnight onToggleSchedule={() => undefined} />);
    expect(screen.getByText('У графіку')).toBeInTheDocument();
    expect(screen.getByText('ваша північ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прибрати з графіка: Азорські острови' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('статуси трансляції: очікується / лише відлік; країна — для зчитувача', () => {
    renderWithApp(
      <>
        <EventCard {...AZORES} status="soon" />
        <EventCard {...CAPE_VERDE} status="soon" />
      </>,
    );
    expect(screen.getByText('Трансляція очікується')).toBeInTheDocument();
    expect(screen.getByText('Лише відлік')).toBeInTheDocument();
    expect(screen.getByText(', Португалія')).toHaveClass('sr-only');
  });
});

describe('NowNext', () => {
  it('карусель: минуле лишається одне; фільтр «З трансляціями» ховає можливі й «лише відлік»', () => {
    renderWithApp(<NowNext items={STRIP} zoneLabel="Київ" />);
    expect(screen.getByRole('heading', { name: 'Зараз і далі' })).toBeInTheDocument();
    expect(screen.getByText('за вашим часом (Київ)')).toBeInTheDocument();
    expect(screen.getByText('Кабо-Верде')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /З трансляціями/ }));
    expect(screen.queryByText('Кабо-Верде')).toBeNull();
    expect(screen.queryByText('Ріо-де-Жанейро')).toBeNull();
    expect(screen.getByText('Лондон')).toBeInTheDocument();
  });

  it('телефон: 4 картки, «Ще N подій», розгортання, «Країни й пояси»', () => {
    renderWithApp(<NowNext items={STRIP} zoneLabel="Київ" layout="stack" mapHref="/countries/" />);
    // Париж минув — на телефоні минулих немає: лишається 9 з 10.
    expect(screen.getAllByRole('article')).toHaveLength(4);
    const more = screen.getByRole('button', { name: /Ще 5 подій/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: /Країни й пояси/ })).toHaveAttribute('href', '/countries/');
    fireEvent.click(more);
    expect(screen.getAllByRole('article')).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Згорнути' })).toBeInTheDocument();
  });

  it('«Мій графік» (рішення 2026-10-31): лише події з графіка й лічильник; без пасу — смужка й притемнені картки', () => {
    const items = STRIP.map((i) => (i.title === 'Ріо-де-Жанейро' ? { ...i, inSchedule: true } : i));
    const { unmount } = renderWithApp(<NowNext items={items} zoneLabel="Київ" />);
    const mine = screen.getByRole('radio', { name: /Мій графік/ });
    expect(mine).toHaveTextContent('1');
    fireEvent.click(mine);
    expect(screen.getByText('Ріо-де-Жанейро')).toBeInTheDocument();
    expect(screen.queryByText('Кабо-Верде')).toBeNull();
    unmount();
    const onScheduleLocked = vi.fn();
    renderWithApp(<NowNext items={items} zoneLabel="Київ" scheduleLocked onScheduleLocked={onScheduleLocked} />);
    fireEvent.click(screen.getByRole('radio', { name: /Мій графік\. Графік — у Новорічному пасі/ }));
    // Варіант C (2026-11-01): фільтр вмикається, згори смужка, картки притемнені й поза Tab.
    expect(screen.getByRole('status')).toHaveTextContent('Мій графік — у Новорічному пасі');
    expect(document.querySelector('[data-row="mine-locked-cards"]')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Що дає пас' }));
    expect(onScheduleLocked).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Усі' }));
    expect(document.querySelector('[data-row="mine-locked"]')).toBeNull();
  });

  it('порожньо після фільтра: підказка й «Показати всі події»', () => {
    renderWithApp(<NowNext items={[CAPE_VERDE]} zoneLabel="Київ" defaultFilterLiveOnly />);
    expect(screen.getByText('Поки немає подій з трансляціями')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Показати всі події' }));
    expect(screen.getByText('Кабо-Верде')).toBeInTheDocument();
  });

  it('завантаження: aria-busy і прихований текст', () => {
    const { container } = renderWithApp(<NowNext items={STRIP} zoneLabel="Київ" loading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Завантажуємо')).toHaveClass('sr-only');
  });

  it('прогрес свята: значення для зчитувача', () => {
    renderWithApp(<FestProgress hoursPassed={13} hoursTotal={26} zonesDone={23} zonesTotal={38} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Минуло 13 год із 26, Новий рік зустріли 23 пояси з 38');
  });
});

describe('CelebrationsSlider', () => {
  it('показує основні святкування в каруселі з назвою секції', () => {
    renderWithApp(<CelebrationsSlider items={STRIP.filter((i) => i.celebrationType === 'main')} />);
    expect(screen.getByRole('heading', { name: 'Основні святкування' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Слайдер основних святкувань' })).toBeInTheDocument();
    expect(screen.getAllByRole('article').length).toBeGreaterThan(2);
  });
});

describe('HowToCard', () => {
  it('повна: заголовок із країною без відмінка, три традиції з номерами', () => {
    renderWithApp(<HowToCard country="Франція" traditions={TRADITIONS.slice(0, 3)} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Як святкувати · Франція' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Ключові традиції' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(screen.getByText('01')).toBeInTheDocument();
  });

  it('компактна: не більше чотирьох пунктів, жовта смуга', () => {
    const { container } = renderWithApp(
      <HowToCard country="Франція" variant="compact" headingLevel="h3" traditions={[...TRADITIONS, { ...TRADITIONS[0]!, id: 't5' }]} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('heading', { level: 3, name: 'Як святкувати' })).toBeInTheDocument();
    expect(container.querySelector('[data-how-to="compact"]')).toHaveClass('border-highlight');
  });
});

describe('CountryChips', () => {
  it('«Ще N» розгортає й згортає; вибір повідомляє країну', () => {
    const onSelect = vi.fn();
    renderWithApp(<CountryChips countries={ZONE_COUNTRIES} selectedIso="FR" onSelect={onSelect} />);
    const group = screen.getByRole('group', { name: 'Країни поясу' });
    expect(within(group).getAllByRole('button', { pressed: undefined })).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Франція' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Італія' }));
    expect(onSelect).toHaveBeenCalledWith('IT');
    const more = screen.getByRole('button', { name: /Ще 3/ });
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Норвегія' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Згорнути/ })).toHaveAttribute('aria-expanded', 'true');
  });
});
