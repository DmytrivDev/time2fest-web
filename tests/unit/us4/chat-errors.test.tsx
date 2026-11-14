/**
 * Стани шва №12–13 (пакет 2026-11-14): повідомлення, яке сервер не прийняв, — текст у полі й «Не надіслано…»;
 * переклад, що не вдався, — оригінал і «Не вдалося перекласти · Спробувати ще»; скарга, що не дійшла, — смуга з
 * «Спробувати ще» на місці подяки.
 */
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { sendReport, type ReportState } from '@/components/chat/hooks/useChatMessageActions';
import { resetSimFaultsForTest, simFaults } from '@/lib/api/sim/faults';
import { useChatFeed } from '@/lib/chat-sim/store';
import { resetTranslations, useTranslateMessage } from '@/lib/chat/translate';
import type { ChatMessage } from '@/lib/data/types';
import { useChatUi } from '@/stores/chat';
import { createDefaultGuest, useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { renderApp } from '../us1/render';

const QUIET = Date.parse('2027-01-01T00:20:00Z');
const FOREIGN: ChatMessage = {
  id: 'm-pt',
  room: 'world',
  kind: 'regular',
  author: { id: 'u_lucas', nick: 'Lucas', flagCode: 'BR', badges: [] },
  text: 'Abraços do Brasil, gente boa!',
  createdAt: QUIET - 60_000,
  moderation: 'ok',
};

beforeEach(() => {
  useChatFeed.getState().reset();
  useChatUi.getState().reset();
  useGuestStore.setState({ ...createDefaultGuest(), nick: 'Мирон', flagCode: 'UA' });
  useTestControls.setState({ chatAvailable: true, offlineSimulated: false });
  resetTranslations();
});
afterEach(() => {
  cleanup();
  resetSimFaultsForTest();
});
vi.setConfig({ testTimeout: 20_000 });

describe('стани відмов чату', () => {
  it('№12: сервер не прийняв повідомлення — текст повернуто в поле, «Не надіслано…»; повторне «Надіслати» — надіслано', async () => {
    const user = userEvent.setup();
    renderApp(<ChatPanel />, QUIET);
    const field = screen.getByRole('textbox', { name: /Повідомлення в чат/ });
    simFaults.failNext('chat', 'send', 'network');
    await user.type(field, 'Привіт усім');
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(field).toHaveValue('Привіт усім'));
    expect(screen.getByText('Не надіслано — перевір зв’язок і надішли ще раз')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Надіслати' }));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(screen.queryByText('Не надіслано — перевір зв’язок і надішли ще раз')).toBeNull();
  });

  it('№13: переклад не вдався — «failed», повтор перекладає', async () => {
    simFaults.failNext('chat', 'translate', 'network');
    const { result } = renderHook(() => useTranslateMessage(FOREIGN, true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.text).toBeUndefined();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.text).toBeDefined());
    expect(result.current.failed).toBe(false);
  });

  it('№13: скарга не дійшла — стан «failed» з повідомленням для «Спробувати ще»', async () => {
    let state: ReportState = true;
    const set = (v: ReportState | ((p: ReportState) => ReportState)) => {
      state = typeof v === 'function' ? v(state) : v;
    };
    simFaults.failNext('chat', 'report', 'network');
    await sendReport(FOREIGN, set);
    expect(state).toEqual({ failed: FOREIGN });
    state = true;
    await sendReport(FOREIGN, set);
    expect(state).toBe(true);
  });
});
