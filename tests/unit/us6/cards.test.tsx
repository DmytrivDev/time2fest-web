import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CookieBanner, CookieSettings } from '@/components/windows/Cookies';
import { PassGate } from '@/components/windows/PassGate';
import { PassInfo } from '@/components/windows/PassInfo';
import { PassOffer } from '@/components/windows/PassOffer';
import { ShareContent } from '@/components/windows/Share';
import { Tips } from '@/components/windows/Tips';
import { renderPage, renderPlain } from './render';

const countries = [
  { iso: 'UA', name: 'Україна', flagCode: 'UA' },
  { iso: 'FR', name: 'Франція', flagCode: 'FR' },
];

const coralButtons = () => [...document.querySelectorAll('[data-variant="coral"]')];

describe('PassOffer', () => {
  it('«Уже 2 країни у твоєму паспорті», 3 головні функції, «Ще в пасі:», ціна, одна коралова кнопка', () => {
    renderPage(<PassOffer count={2} countries={countries} onClose={() => undefined} onDetails={() => undefined} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Уже 2 країни у твоєму паспорті' })).toBeInTheDocument();
    expect(screen.getByText('Україна')).toBeInTheDocument();
    expect(screen.getByText('Франція')).toBeInTheDocument();
    expect(screen.getByText('Зроби свій шлях видимим і збирай розклад.')).toBeInTheDocument();
    const main = screen.getByRole('list', { name: 'Головне в пасі' });
    expect(within(main).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Ще в пасі:')).toBeInTheDocument();
    expect(screen.getByText('Тихий режим чату')).toBeInTheDocument();
    expect(screen.getByText('$4,99')).toBeInTheDocument();
    expect(screen.getByText('разово, на весь сезон · без підписки')).toBeInTheDocument();
    expect(coralButtons()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Оформити пас' })).toHaveAttribute('data-variant', 'coral');
  });

  it('коралова кнопка робить кнопку звуку нейтральною', () => {
    renderPage(<PassOffer count={2} countries={countries} />);
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
  });

  it('текст у називному відмінку: для кількох форм «країна / країни / країн»', () => {
    renderPage(<PassOffer count={5} countries={countries} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Уже 5 країн у твоєму паспорті');
  });

  it('«Оформити пас» — імітоване повідомлення, без чекауту', () => {
    renderPage(<PassOffer count={2} countries={countries} />);
    expect(screen.queryByText('Оплата буде на наступному етапі')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Оформити пас' }));
    expect(screen.getByRole('status')).toHaveTextContent('Оплата буде на наступному етапі');
    expect(document.querySelector('iframe, form')).toBeNull();
  });

  it('«×», Esc і «Детальніше»', () => {
    const onClose = vi.fn();
    const onDetails = vi.fn();
    renderPage(<PassOffer count={2} countries={countries} onClose={onClose} onDetails={onDetails} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити пропозицію' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Детальніше' }));
    expect(onDetails).toHaveBeenCalledTimes(1);
  });

  it('Esc з фокусом в іншому місці (поле чату) картку не закриває', () => {
    const onClose = vi.fn();
    renderPage(
      <>
        <input aria-label="Повідомлення" />
        <PassOffer count={2} countries={countries} onClose={onClose} />
      </>,
    );
    screen.getByLabelText('Повідомлення').focus();
    fireEvent.keyDown(screen.getByLabelText('Повідомлення'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('знижка на «Перший ряд» — лише тим, хто писав у чаті; головних усе одно три', () => {
    const { unmount } = renderPage(<PassOffer count={2} countries={countries} />);
    expect(screen.queryByText('−50% на «Перший ряд»')).toBeNull();
    unmount();
    renderPage(<PassOffer count={2} countries={countries} wroteInChat />);
    const main = screen.getByRole('list', { name: 'Головне в пасі' });
    expect(within(main).getAllByRole('listitem')).toHaveLength(3);
    expect(within(main).getByText('−50% на «Перший ряд»')).toBeInTheDocument();
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

describe('Tips', () => {
  it('$2 / $5 / $10, вибір змінює кнопку «Підтримати $N»; примітка про email', () => {
    renderPage(<Tips onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Чайові' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['$2', '$5', '$10']);
    expect(screen.getByRole('button', { name: 'Підтримати $2' })).toHaveAttribute('data-variant', 'coral');
    fireEvent.click(screen.getByRole('radio', { name: '$10' }));
    expect(screen.getByRole('button', { name: 'Підтримати $10' })).toBeInTheDocument();
    expect(screen.getByText(/Входити не треба — email для квитанції попросить сторінка оплати/)).toBeInTheDocument();
    expect(coralButtons()).toHaveLength(1);
  });

  it('«Підтримати» — імітоване повідомлення, без чекауту', () => {
    const onSupport = vi.fn();
    renderPage(<Tips onSupport={onSupport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати $2' }));
    expect(onSupport).toHaveBeenCalledWith(2);
    expect(screen.getByRole('status')).toHaveTextContent('Оплата буде на наступному етапі');
  });
});

describe('PassGate', () => {
  it('«Щоб додавати в графік, потрібен Новорічний пас»; «Що дає пас» нейтральна, коралової немає', () => {
    const onWhat = vi.fn();
    renderPage(<PassGate onWhatPassGives={onWhat} onClose={() => undefined} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Щоб додавати в графік, потрібен Новорічний пас' })).toBeInTheDocument();
    expect(screen.getByText('Перше нагадування — безплатно.')).toBeInTheDocument();
    expect(coralButtons()).toHaveLength(0);
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
    fireEvent.click(screen.getByRole('button', { name: 'Що дає пас' }));
    expect(onWhat).toHaveBeenCalledTimes(1);
  });

  it('тихий режим: інший заголовок, без рядка про безплатне нагадування', () => {
    renderPage(<PassGate feature="quiet-mode" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('тихий режим чату');
    expect(screen.queryByText('Перше нагадування — безплатно.')).toBeNull();
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
