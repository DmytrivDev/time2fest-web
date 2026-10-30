import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { AuthorPanel } from '@/components/live/AuthorPanel';
import { OverlayInFlowOutlet, OverlayManager } from '@/components/shell/OverlayManager';
import { isBanalText, isQuietHidden, quietHiddenCount } from '@/lib/chat/quiet';
import { messageLang, resetTranslations } from '@/lib/chat/translate';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { Author, ChatMessage } from '@/lib/data/types';
import { CoralProvider } from '@/lib/overlay/coral';
import { useChatUi } from '@/stores/chat';
import { useChatPrefs } from '@/stores/chatPrefs';
import { createDefaultGuest, useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { renderApp, stubBrowserApis } from '../us1/render';

stubBrowserApis();

const AT = Date.parse('2027-01-01T00:20:00Z');
const EMMA: Author = { id: 'u_emma', nick: 'Emma', flagCode: 'GB', badges: [] };
const PIERRE: Author = { id: 'u_pierre', nick: 'Pierre', flagCode: 'FR', badges: [] };
const TARAS: Author = { id: 'u_taras', nick: 'Тарас', flagCode: 'UA', badges: [] };

const msg = (id: string, author: Author, text: string, at = AT - 60_000): ChatMessage => ({
  id,
  room: 'world',
  kind: 'regular',
  createdAt: at,
  author,
  text,
  moderation: 'ok',
});
const counter: ChatMessage = {
  id: 'c1',
  room: 'world',
  kind: 'system',
  createdAt: AT - 50_000,
  system: { kind: 'greetings-counter', count: 240, flagCodes: ['IN'], eventId: 'e' },
  moderation: 'ok',
};

function setup(ui = <ChatPanel />) {
  return renderApp(
    <CoralProvider>
      <OverlayManager>
        <OverlayInFlowOutlet />
        {ui}
      </OverlayManager>
    </CoralProvider>,
    AT,
  );
}

const dots = () => screen.getByRole('button', { name: 'Налаштування чату' });

beforeEach(() => {
  useChatFeed.getState().reset();
  useChatUi.getState().reset();
  useChatPrefs.getState().reset();
  resetTranslations();
  useGuestStore.setState({ ...createDefaultGuest(), nick: 'Олена', flagCode: 'UA', hasPass: false });
  useTestControls.setState({ chatAvailable: true, offlineSimulated: false });
  useChatFeed.getState().append([
    msg('m1', EMMA, 'Happy New Year, everyone!'),
    counter,
    msg('m2', TARAS, 'Хто з якої країни? Пишіть!'),
    msg('m3', PIERRE, 'Bonne année à tous !'),
  ]);
});
afterEach(cleanup);
vi.setConfig({ testTimeout: 20_000 });

describe('тихий режим і переклад — правила', () => {
  it('банальні привітання будь-якою мовою; змістовні — ні', () => {
    expect(isBanalText('Happy New Year, everyone! 🎉')).toBe(true);
    expect(isBanalText('З Новим роком!')).toBe(true);
    expect(isBanalText('Bonne année à tous !')).toBe(true);
    expect(isBanalText('Хто з якої країни? Пишіть!')).toBe(false);
    expect(isBanalText('Happy New Year from a rainy Sydney beach party tonight')).toBe(false);
  });
  it('власники пасу й відповіді мені не ховаються; лічильник рахується повністю', () => {
    expect(isQuietHidden(msg('x', { ...EMMA, badges: ['pass'] }, 'Happy New Year!'), 'Олена')).toBe(false);
    expect(isQuietHidden({ ...msg('y', EMMA, 'З Новим роком!'), replyTo: { id: 'z', nick: 'Олена', excerpt: '' } }, 'Олена')).toBe(false);
    expect(quietHiddenCount([msg('a', EMMA, 'Happy New Year!'), counter], 'Олена')).toBe(241);
  });
  it('мова: кирилицю не перекладаємо, інше — за прапором автора', () => {
    expect(messageLang(msg('a', TARAS, 'Привіт'))).toBeNull();
    expect(messageLang(msg('b', PIERRE, 'Bonne année'))).toBe('fr');
    expect(messageLang({ ...msg('c', EMMA, 'Hi'), lang: 'uk' } as ChatMessage & { lang: string })).toBeNull();
  });
});

describe('«⋯» — налаштування чату на місці стрічки', () => {
  it('відкриває налаштування замість стрічки, «⋯» підсвічена; Esc повертає стрічку й фокус на «⋯»', async () => {
    setup();
    expect(screen.getByText('Хто з якої країни? Пишіть!')).toBeInTheDocument();
    fireEvent.click(dots());
    const heading = screen.getByRole('heading', { name: 'Налаштування чату' });
    expect(heading).toHaveFocus();
    expect(dots()).toHaveAttribute('aria-expanded', 'true');
    expect(dots()).toHaveAttribute('data-active', 'true');
    expect(screen.queryByText('Хто з якої країни? Пишіть!')).not.toBeInTheDocument();
    // Поле введення лишається.
    expect(screen.getByRole('textbox', { name: /Повідомлення в чат/ })).toBeInTheDocument();
    fireEvent.keyDown(heading, { key: 'Escape' });
    await waitFor(() => expect(dots()).toHaveFocus());
    expect(screen.getByText('Хто з якої країни? Пишіть!')).toBeInTheDocument();
  });

  it('без пасу: перемикачі вимкнені зі значком пасу, дотик — «Потрібен Новорічний пас»; картка пасу внизу', async () => {
    setup();
    fireEvent.click(dots());
    const quiet = screen.getByRole('switch', { name: /Тихий режим/ });
    expect(quiet).toHaveAttribute('aria-checked', 'false');
    expect(quiet).toHaveAttribute('aria-disabled', 'true');
    expect(within(quiet).getByRole('img', { name: 'Потрібен Новорічний пас' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Показувати мій шлях/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Оформити пас — $4,99' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Дізнатись більше' })).toHaveAttribute('href', expect.stringMatching(/^\/pass\/?$/));
    fireEvent.click(quiet);
    expect(await screen.findByText('Щоб увімкнути тихий режим чату, потрібен Новорічний пас')).toBeInTheDocument();
  });

  it('з пасом: шлях увімкнено одразу; тихий режим ховає привітання й рахує сховане', () => {
    useGuestStore.setState({ hasPass: true });
    setup();
    fireEvent.click(dots());
    expect(screen.getByText('діють у всіх кімнатах')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Оформити пас/ })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Показувати мій шлях/ })).toHaveAttribute('aria-checked', 'true');
    const quiet = screen.getByRole('switch', { name: /Тихий режим/ });
    fireEvent.click(quiet);
    expect(quiet).toHaveAttribute('aria-checked', 'true');
    expect(within(quiet).getByText('Приховано 242 однакові привітання')).toBeInTheDocument();
    fireEvent.click(dots());
    expect(screen.queryByText('Happy New Year, everyone!')).not.toBeInTheDocument();
    expect(screen.getByText('Хто з якої країни? Пишіть!')).toBeInTheDocument();
  });

  it('«Мій нік і прапор» — олівець відкриває O-NICK; надіслане повідомлення закриває налаштування', async () => {
    const user = userEvent.setup();
    setup();
    fireEvent.click(dots());
    expect(screen.getByText('Олена')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /Повідомлення в чат/ }), 'Усім привіт із Києва');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Налаштування чату' })).not.toBeInTheDocument());
    expect(screen.getByText('Усім привіт із Києва')).toBeInTheDocument();
    fireEvent.click(dots());
    fireEvent.click(screen.getByRole('button', { name: 'Змінити нік і прапор' }));
    expect(await screen.findByRole('dialog', { name: /Як тебе підписати/ })).toBeInTheDocument();
  });
});

describe('переклад повідомлень (пас)', () => {
  it('«Перекладати повідомлення»: чужа мова — українською з «Перекладено з … · Оригінал»', async () => {
    useGuestStore.setState({ hasPass: true });
    useChatPrefs.getState().set('translate', true);
    setup();
    expect(await screen.findAllByText('З Новим роком усіх!', {}, { timeout: 3_000 })).toHaveLength(2);
    const caption = screen.getAllByText(/Перекладено з/);
    expect(caption.map((c) => c.textContent)).toEqual(expect.arrayContaining(['Перекладено з англійської', 'Перекладено з французької']));
    expect(screen.getByText('Хто з якої країни? Пишіть!')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Оригінал' })[0]!);
    expect(screen.getByText('Happy New Year, everyone!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показати переклад' })).toBeInTheDocument();
  });
  it('без пасу переклад не вмикається, навіть якщо збережено', () => {
    useChatPrefs.getState().set('translate', true);
    setup();
    expect(screen.getByText('Happy New Year, everyone!')).toBeInTheDocument();
    expect(screen.queryByText(/Перекладено з/)).not.toBeInTheDocument();
  });
});

describe('«Сповіщати про відповіді» (пас)', () => {
  it('чат сховано, тобі відповіли — на кнопці «Тобі відповіли»; вимкнено — позначки немає', () => {
    useGuestStore.setState({ hasPass: true });
    useChatPrefs.getState().set('notifyReplies', true);
    useChatUi.getState().markHidden(AT - 10_000);
    const reply = { ...msg('r1', EMMA, 'І тебе!', AT - 1_000), replyTo: { id: 'm9', nick: 'Олена', excerpt: 'Привіт' } };
    act(() => useChatFeed.getState().append([reply]));
    const { unmount } = renderApp(<ChatHiddenButton room="world" onShow={() => {}} />, AT);
    expect(screen.getByRole('button', { name: /Тобі відповіли: 1/ })).toBeInTheDocument();
    unmount();
    useChatPrefs.getState().set('notifyReplies', false);
    renderApp(<ChatHiddenButton room="world" onShow={() => {}} />, AT);
    expect(screen.queryByRole('button', { name: /Тобі відповіли/ })).not.toBeInTheDocument();
  });
});

describe('панель автора: шлях приховано', () => {
  it('автор з пасом вимкнув «Показувати мій шлях» — плашка «{нік} приховав свій шлях», позначка пасу лишається', () => {
    renderApp(
      <AuthorPanel author={{ id: 'u_mehmet', nick: 'Mehmet', flagCode: 'TR', badges: ['pass'] }} countryName="Туреччина" hasPass routeHidden path={[]} />,
      AT,
    );
    expect(document.querySelector('[data-row="route-hidden"]')).toHaveTextContent('Mehmet приховав свій шлях');
    expect(document.querySelector('[data-badge="pass"]')).toBeInTheDocument();
    expect(screen.queryByText('Переглянути шлях')).not.toBeInTheDocument();
  });
});
