import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { OverlayManager } from '@/components/shell/OverlayManager';
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
    expect(dock().querySelector('[data-dock-pill]')).toBeNull();
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
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Згорнути чат' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Згорнути чат' }));
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
    expect(document.documentElement.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dock()).toHaveAttribute('data-state', 'collapsed');
  });

  it('при розгортанні лічильник скидається, при згортанні рахунок іде знову', async () => {
    const user = userEvent.setup();
    setup();
    act(() => useChatFeed.getState().append([msg('n1', NOW + 1_000)]));
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    expect(useChatUi.getState().hiddenAt).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Згорнути чат' }));
    expect(dock().querySelector('[data-dock-pill]')).toBeNull();
  });

  it('вікно чату (правила) відкривається всередині розгорнутого вікна, а не аркушем', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /^Розгорнути чат/ }));
    await user.click(screen.getByRole('button', { name: 'Ще дії чату' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Правила чату' }));
    const slot = document.getElementById('chat-dock-slot')!;
    await waitFor(() => expect(slot.querySelector('[data-chat-slot-panel]')).not.toBeNull());
    expect(document.querySelector('[data-sheet]')).toBeNull();
  });
});
