import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CookieBanner, CookieSettings } from '@/components/windows/Cookies';
import { PassGate } from '@/components/windows/PassGate';
import { PassInfo } from '@/components/windows/PassInfo';
import { PassOffer } from '@/components/windows/PassOffer';
import { ShareContent } from '@/components/windows/Share';
import { Tips } from '@/components/windows/Tips';
import { renderPage, renderPlain } from './render';

const MIN = 60_000;
const NOW = Date.parse('2027-01-01T00:06:00Z');
const pt = (eventId: string, flagCode: string, city: string, midnightMs: number) => ({ eventId, flagCode, city, midnightMs });
const met = [pt('evt_paris_2027', 'FR', 'Париж', NOW - 66 * MIN), pt('evt_london_2027', 'GB', 'Лондон', NOW - 6 * MIN)];
const next = [pt('evt_azores_2027', 'PT', 'Азорські острови', NOW + 54 * MIN), pt('cv', 'CV', 'Прая', NOW + 54 * MIN + 1), pt('br', 'BR', 'Ріо-де-Жанейро', NOW + 174 * MIN)];
const offer = (extra: Partial<Parameters<typeof PassOffer>[0]> = {}) => <PassOffer count={2} met={met} next={next} now={NOW} {...extra} />;

const coralButtons = () => [...document.querySelectorAll('[data-variant="coral"]')];

describe('PassOffer — «Наступна північ» (рішення 2026-11-01)', () => {
  it('«2 Нових роки вже твої — далі буде ще краще», шлях (зустріли / зараз / попереду), наступна північ «за 54 хв», одна коралова', () => {
    renderPage(offer({ onClose: () => undefined, onDetails: () => undefined }));
    expect(screen.getByText('Твій новорічний шлях', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '2 Нових роки вже твої — далі буде ще краще' })).toBeInTheDocument();
    const path = screen.getByRole('list', { name: 'Твій новорічний шлях' });
    expect(within(path).getByText(/^Париж, .* — зустріли$/)).toBeInTheDocument();
    expect(within(path).getByText('зараз')).toBeInTheDocument();
    expect(within(path).getByText(/^Ріо-де-Жанейро, .* — попереду$/)).toBeInTheDocument();
    expect(path.querySelectorAll('[data-round="true"]')).toHaveLength(5);
    expect(screen.getByText('Наступна північ · за 54 хв')).toBeInTheDocument();
    expect(screen.getByText(/^Азорські острови · /)).toBeInTheDocument();
    expect(screen.getByText('З пасом — нагадаємо перед північчю')).toBeInTheDocument();
    expect(coralButtons()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Оформити пас · $4,99' })).toHaveAttribute('data-variant', 'coral');
  });

  it('коралова кнопка робить кнопку звуку нейтральною', () => {
    renderPage(offer());
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
  });

  it('множина: «5 Нових років уже твої»', () => {
    renderPage(offer({ count: 5 }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('5 Нових років уже твої — далі буде ще краще');
  });

  it('довга ніч: у шляху — останні 4 зустрінуті; на телефоні ранніші позначено data-wide', () => {
    const long = [pt('a', 'JP', 'Токіо', NOW - 600 * MIN), pt('b', 'AE', 'Дубай', NOW - 300 * MIN), ...met, pt('c', 'NZ', 'Окленд', NOW - 800 * MIN)].sort((x, y) => x.midnightMs - y.midnightMs);
    renderPage(offer({ count: 5, met: long }));
    const path = screen.getByRole('list', { name: 'Твій новорічний шлях' });
    expect(within(path).queryByText(/^Окленд/)).toBeNull();
    expect(path.querySelectorAll('[data-met][data-wide]')).toHaveLength(2);
  });

  it('«Оформити пас», «Детальніше» (десктоп і телефон), «×», Esc', () => {
    const onGetPass = vi.fn();
    const onClose = vi.fn();
    const onDetails = vi.fn();
    renderPage(offer({ onGetPass, onClose, onDetails }));
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас · $4,99' }));
    expect(onGetPass).toHaveBeenCalledOnce();
    screen.getAllByRole('button', { name: 'Детальніше' }).forEach((b) => fireEvent.click(b));
    expect(onDetails).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити пропозицію' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('PassInfo', () => {
  it('«Що дає Новорічний пас»: головні функції з поясненням, «Ще в пасі:», ціна, одна коралова', () => {
    renderPage(<PassInfo onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Що дає Новорічний пас' })).toBeInTheDocument();
    expect(screen.getByText('Додавай події в графік — нагадаємо перед кожною.')).toBeInTheDocument();
    expect(screen.getByText('Картка «Мої Нові роки»')).toBeInTheDocument();
    expect(screen.getByText('Ще в пасі:')).toBeInTheDocument();
    expect(coralButtons()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Детальніше' })).toBeNull();
  });
});

describe('Tips — «Скажи тост на весь світ» (рішення 2026-11-01)', () => {
  it('надзаголовок «Чайові», $2 / $5 / $10 (типово $5), прев’ю тосту — поле з ніком; примітка про email', () => {
    renderPage(<Tips nick="Олена" flagCode="UA" onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Скажи тост на весь світ' })).toBeInTheDocument();
    expect(screen.getByText('Чайові')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['$2', '$5', '$10']);
    expect(screen.getByRole('button', { name: 'Підтримати $5' })).toHaveAttribute('data-variant', 'coral');
    fireEvent.click(screen.getByRole('radio', { name: '$10' }));
    expect(screen.getByRole('button', { name: 'Підтримати $10' })).toBeInTheDocument();
    expect(screen.getByText('Олена')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Текст твого тосту' })).toHaveValue('🥂 Піднімаю келих за всіх, хто зустрічає Новий рік разом!');
    expect(screen.getByText(/Входити не треба — email для квитанції попросить сторінка оплати/)).toBeInTheDocument();
    expect(coralButtons()).toHaveLength(1);
  });

  it('«Підтримати» — передає суму й текст тосту (оплата — у вікні); посилання в тості не пропускаємо', () => {
    const onSupport = vi.fn();
    renderPage(<Tips onSupport={onSupport} />);
    expect(screen.getByText('Гість')).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Текст твого тосту' });
    fireEvent.change(field, { target: { value: 'дивіться www.spam.com' } });
    expect(screen.getByRole('button', { name: 'Підтримати $5' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 'За всіх, хто не спить!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати $5' }));
    expect(onSupport).toHaveBeenCalledWith(5, 'За всіх, хто не спить!');
    // Кнопка не змінюється — оплата й «Дякуємо» відбуваються у вікні «Чайові».
    expect(screen.getByRole('button', { name: 'Підтримати $5' })).toBeEnabled();
  });
});

describe('PassGate', () => {
  it('«Щоб додавати в графік, потрібен Новорічний пас»; «Що дає пас» нейтральна, коралової немає', () => {
    const onWhat = vi.fn();
    renderPage(<PassGate onWhatPassGives={onWhat} onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Щоб додавати в графік, потрібен Новорічний пас' })).toBeInTheDocument();
    // Безплатного нагадування немає (рішення 2026-11-01).
    expect(screen.queryByText(/безплатн/)).toBeNull();
    expect(coralButtons()).toHaveLength(0);
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
    fireEvent.click(screen.getByRole('button', { name: 'Що дає пас' }));
    expect(onWhat).toHaveBeenCalledTimes(1);
  });

  it('тихий режим: інший заголовок', () => {
    renderPage(<PassGate feature="quiet-mode" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('тихий режим чату');
  });
});

describe('CookieBanner', () => {
  it('три рівноцінні secondary-кнопки, коралової немає', () => {
    const onAccept = vi.fn();
    const onNecessary = vi.fn();
    const onCustomize = vi.fn();
    renderPlain(<CookieBanner variant="corner" onAccept={onAccept} onNecessaryOnly={onNecessary} onCustomize={onCustomize} />);
    const region = screen.getByRole('region', { name: 'Cookies на Time2Fest' });
    const buttons = within(region).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Прийняти', 'Лише необхідні', 'Налаштувати']);
    for (const b of buttons) expect(b).toHaveAttribute('data-variant', 'secondary');
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    fireEvent.click(buttons[2]!);
    expect([onAccept, onNecessary, onCustomize].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    expect(region).toHaveAttribute('data-cookie-banner', 'corner');
  });

  it('варіанти strip / inflow і стан «не збережено»', () => {
    const onRetry = vi.fn();
    const { unmount } = renderPlain(<CookieBanner variant="strip" />);
    expect(screen.getByRole('region', { name: 'Згода на cookies' })).toHaveAttribute('data-cookie-banner', 'strip');
    unmount();
    renderPlain(<CookieBanner variant="inflow" saveFailed onRetry={onRetry} />);
    expect(document.querySelector('[data-cookie-banner="inflow"]')).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося зберегти вибір');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('CookieSettings', () => {
  it('чотири категорії: «Необхідні» завжди ввімкнені, решта перемикаються; зберігає вибір', () => {
    const onSave = vi.fn();
    renderPlain(<CookieSettings value={{ analytics: false, marketing: false, facebookVideo: false }} onSave={onSave} />);
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(4);
    expect(screen.getByRole('switch', { name: 'Необхідні' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Необхідні' })).toBeChecked();
    expect(screen.getByText('Завжди увімкнені')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Відео з Facebook' }));
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти вибір' }));
    expect(onSave).toHaveBeenCalledWith({ analytics: false, marketing: false, facebookVideo: true });
    expect(screen.getByText(/«Налаштуваннях cookies» внизу сторінки/)).toBeInTheDocument();
  });

  it('коралова «Зберегти вибір» робить звук нейтральним', () => {
    renderPage(<CookieSettings value={{ analytics: false, marketing: false, facebookVideo: false }} />);
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    expect(coralButtons()).toHaveLength(1);
  });
});

describe('ShareContent', () => {
  const data = { place: 'Сідней', time: '12:00', url: 'https://time2fest.com/country/australia/' };

  it('прев’ю 9:16 → 1:1, alt = підпис картки, «генерується» до завантаження', () => {
    renderPage(<ShareContent data={data} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('alt', 'Прев’ю картки: Сідней · Новий рік о 12:00 за вашим часом');
    expect(img).toHaveAttribute('width', '1080');
    expect(img).toHaveAttribute('height', '1920');
    expect(screen.getByText('Готуємо картку')).toBeInTheDocument();
    fireEvent.load(img);
    expect(screen.queryByText('Готуємо картку')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '1:1' }));
    expect(screen.getByRole('img')).toHaveAttribute('height', '1080');
  });

  it('системний шеринг — першим і єдиною кораловою; WhatsApp — посилання', () => {
    renderPage(<ShareContent data={data} />);
    const actions = within(document.querySelector('[data-row="actions"]') as HTMLElement).getAllByRole('listitem');
    expect(within(actions[0]!).getByRole('button', { name: 'Поділитися…' })).toHaveAttribute('data-variant', 'coral');
    expect(coralButtons()).toHaveLength(1);
    const wa = screen.getByRole('link', { name: 'WhatsApp' });
    expect(wa.getAttribute('href')).toContain('https://wa.me/?text=');
    expect(wa).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('«Поділитися…» викликає системний шеринг з адресою', async () => {
    const onNativeShare = vi.fn();
    renderPage(<ShareContent data={data} onNativeShare={onNativeShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поділитися…' }));
    await vi.waitFor(() => expect(onNativeShare).toHaveBeenCalled());
    expect(onNativeShare.mock.calls[0]![0].url).toBe(data.url);
  });

  it('«Копіювати посилання» → «Посилання скопійовано»', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage(<ShareContent data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'Копіювати посилання' }));
    await vi.waitFor(() => expect(screen.getAllByText('Посилання скопійовано').length).toBeGreaterThan(0));
    expect(writeText).toHaveBeenCalledWith(data.url);
  });

  it('«Завантажити зображення» віддає PNG, збій — повідомлення', async () => {
    const onDownload = vi.fn();
    const blob = new Blob(['x'], { type: 'image/png' });
    const { unmount } = renderPage(<ShareContent data={data} renderPng={() => Promise.resolve(blob)} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити зображення' }));
    await vi.waitFor(() => expect(onDownload).toHaveBeenCalledWith(blob, 'time2fest-stamp-9x16.png'));
    unmount();
    renderPage(<ShareContent data={data} renderPng={() => Promise.reject(new Error('x'))} onDownload={onDownload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Завантажити зображення' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося підготувати зображення'));
  });
});
