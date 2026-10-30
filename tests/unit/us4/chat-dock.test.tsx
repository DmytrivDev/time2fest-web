import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { OverlayManager, PHONE_LANDSCAPE_QUERY } from '@/components/shell/OverlayManager';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { Author, ChatMessage } from '@/lib/data/types';
import { CoralProvider } from '@/lib/overlay/coral';
import { useChatUi } from '@/stores/chat';
import { useChatDock } from '@/stores/chatDock';
import { createDefaultGuest, useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { renderApp, stubBrowserApis } from '../us1/render';

stubBrowserApis();
vi.setConfig({ testTimeout: 20_000 });

const NOW = Date.parse('2027-01-01T00:20:00Z');
const TARAS: Author = { id: 'u_taras', nick: 'Тарас', flagCode: 'UA', badges: [] };
const ME: Author = { id: 'me', nick: 'Я', flagCode: 'UA', badges: [], isMine: true };

const msg = (id: string, at: number, author: Author = TARAS): ChatMessage => ({
  id,
  room: 'world',
  kind: 'regular',
  createdAt: at,
  author,
  text: `текст ${id}`,
  moderation: 'ok',
});

function setup() {
  return renderApp(
    <CoralProvider>
      <OverlayManager>
        <ChatDock room="world" roomLabel="Світ">
          <ChatPanel collapseMode onHide={() => useChatDock.getState().setExpanded(false)} className="min-h-0 flex-1" />
        </ChatDock>
      </OverlayManager>
    </CoralProvider>,
    NOW,
  );
}

beforeEach(() => {
  useChatFeed.getState().reset();
  useChatUi.getState().reset();
  useChatDock.setState({ expanded: false });
  useGuestStore.setState({ ...createDefaultGuest(), nick: 'Я', flagCode: 'UA' });
  useTestControls.setState({ chatAvailable: true, offlineSimulated: false });
  useChatFeed.getState().append([msg('m1', NOW - 60_000)]);
});
afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

const dock = () => document.querySelector<HTMLElement>('[data-chat-dock]')!;

describe('ChatDock — вікно чату внизу на телефоні', () => {
  it('згорнуте за замовчуванням: «Розгорнути чат», без лічильника, вміст недоступний', () => {
    setup();
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
    expect(screen.getByRole('button', { name: 'Розгорнути чат «Світ»' })).toBeInTheDocument();
    // Без нових — темна пілюля «0 нових» (жовта лише коли N > 0).
    expect(dock().querySelector('[data-dock-pill]')).toHaveAttribute('data-zero', 'true');
    expect(dock().querySelector('[data-dock-pill]')).toHaveTextContent('0 нових');
    expect(document.querySelector('.t2f-dock-body')).toHaveAttribute('inert');
  });

  it('лічильник «N нових» рахує чужі повідомлення від згортання, власні — ні', () => {
    setup();
    act(() => {
      useChatFeed.getState().append([msg('n1', NOW + 1_000), msg('n2', NOW + 2_000), msg('own', NOW + 3_000, ME)]);
    });
    expect(screen.getByRole('button', { name: 'Розгорнути чат «Світ», нових повідомлень: 2' })).toBeInTheDocument();
    expect(dock().querySelector('[data-dock-pill]')).toHaveTextContent('2 нових');
  });

  it('дотик розгортає: сторінка не прокручується, шеврон і Esc згортають', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    expect(dock()).toHaveAttribute('data-state', 'expanded');
    // Сторінка не блокується: чат накриває низ, запас унизу сторінки = висота чату.
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.documentElement).toHaveAttribute('data-chat-dock-pad');
    expect(screen.queryByRole('button', { name: 'До відео' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Згорнути чат' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Згорнути чат' }));
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
    expect(document.documentElement.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
  });

  it('недоступний: у розгорнутому вікні заголовок і «Згорнути чат», без чипів і поля; у згорнутому «0 нових»', async () => {
    const user = userEvent.setup();
    useTestControls.setState({ chatAvailable: false });
    setup();
    act(() => useChatFeed.getState().append([msg('n1', NOW + 1_000)]));
    expect(dock().querySelector('[data-dock-pill]')).toHaveTextContent('0 нових');
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    expect(screen.getByRole('heading', { name: /Чат тимчасово недоступний/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Пауза чату' })).toBeNull();
    expect(document.querySelector('.t2f-dock-grip-handle')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Згорнути чат' }));
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
  });

  it('при розгортанні лічильник скидається, при згортанні рахунок іде знову', async () => {
    const user = userEvent.setup();
    setup();
    act(() => useChatFeed.getState().append([msg('n1', NOW + 1_000)]));
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    expect(useChatUi.getState().hiddenAt).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Згорнути чат' }));
    expect(dock().querySelector('[data-dock-pill]')).toHaveAttribute('data-zero', 'true');
  });

  it('правила чату — на місці стрічки в розгорнутому вікні: «‹» повертає до налаштувань, «Зрозуміло» — до чату', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    // «⋯» відкриває налаштування чату на місці стрічки; звідти — «Правила чату».
    await user.click(screen.getByRole('button', { name: 'Налаштування чату' }));
    await user.click(await screen.findByRole('button', { name: /Правила чату/ }));
    const rules = await waitFor(() => document.querySelector('[data-chat-rules]')!);
    expect(rules).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Правила чату' })).toHaveFocus();
    expect(rules.querySelectorAll('[data-rule]')).toHaveLength(5);
    expect(document.querySelector('[data-sheet]')).toBeNull();
    expect(document.querySelector('[data-chat-slot-panel]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Назад до налаштувань чату' }));
    expect(document.querySelector('[data-chat-settings]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: /Правила чату/ }));
    await user.click(screen.getByRole('button', { name: 'Зрозуміло' }));
    await waitFor(() => expect(document.querySelector('[data-chat-rules]')).toBeNull());
    expect(document.querySelector('[data-chat-settings]')).toBeNull();
  });

  it('телефон: меню «⋯» стоїть у потоці стрічки одразу під своїм повідомленням', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    await user.click(document.querySelector<HTMLElement>('[data-msg-trigger]')!);
    const menu = await screen.findByRole('menu', { name: 'Дії з повідомленням' });
    const item = menu.closest('li')!;
    expect(item).toHaveClass('t2f-mm-inline-item');
    expect(menu).toHaveAttribute('data-placement', 'inline');
    const message = item.previousElementSibling as HTMLElement;
    expect(message).toHaveAttribute('data-msg-id', 'm1');
    expect(message).toHaveAttribute('data-actions-open', 'true');
    expect(document.querySelectorAll('[data-message-menu]')).toHaveLength(1);
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('[data-message-menu]')).toBeNull());
  });
});

describe('ChatDock — телефон в альбомній орієнтації', () => {
  const original = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({
      matches: q === PHONE_LANDSCAPE_QUERY,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    window.matchMedia = original;
    document.documentElement.removeAttribute('data-chat-land-expanded');
  });

  it('згорнуте вікно сховане, поки не прокручено нижче смуги; відступ футера лише коли воно видно', () => {
    setup();
    expect(dock()).toHaveAttribute('data-land', 'true');
    expect(dock()).toHaveAttribute('data-land-hidden', 'true');
    expect(document.documentElement).not.toHaveAttribute('data-has-chat-dock');
    expect(dock().querySelector('[data-dock-expand]')).toHaveAttribute('inert');
  });

  it('розгорнутий чат — блок у потоці: сторінка не блокується', async () => {
    useChatDock.setState({ expanded: true });
    setup();
    expect(dock()).toHaveAttribute('data-state', 'expanded');
    expect(document.documentElement).toHaveAttribute('data-chat-land-expanded');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.documentElement).not.toHaveAttribute('data-has-chat-dock');
    expect(window.scrollTo).toHaveBeenCalled();
    // Кнопка «До відео» — лише в розгорнутому чаті в альбомі.
    expect(screen.getByRole('button', { name: 'До відео' })).toHaveTextContent('До відео');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
    expect(document.documentElement).not.toHaveAttribute('data-chat-land-expanded');
  });
});
