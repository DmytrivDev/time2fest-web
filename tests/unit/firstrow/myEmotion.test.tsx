import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MyEmotionPanel } from '@/components/windows/Emoji';
import { useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { renderApp, stubBrowserApis } from '../us1/render';

const EV = 'evt_london_2027';
beforeAll(stubBrowserApis);
beforeEach(() => {
  useChatUi.setState({ emotionChangedAt: null });
  useGuestStore.setState({ nick: 'Олена', flagCode: 'UA', firstRow: { [EV]: { seat: 4, draft: { name: 'Олена', greeting: 'Привіт', emojiId: 'glasses' } } } });
});

describe('MyEmotionPanel', () => {
  it('вибір лише змінює вигляд; «Зберегти» застосовує емоцію й привітання разом', () => {
    const onSaved = vi.fn();
    renderApp(<MyEmotionPanel eventId={EV} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Феєрверк' }));
    expect(useGuestStore.getState().firstRow[EV]!.draft!.emojiId).toBe('glasses');
    fireEvent.change(screen.getByLabelText(/Привітання/), { target: { value: 'Новий текст' } });
    expect(screen.getByText('11/80')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));
    expect(useGuestStore.getState().firstRow[EV]!.draft).toMatchObject({ emojiId: 'fireworks', greeting: 'Новий текст' });
    expect(onSaved).toHaveBeenCalledWith({ emojiId: 'fireworks', greetingChanged: true });
  });

  it('раз на 10 с: «Зберегти» неактивна з відліком', () => {
    const now = Date.parse('2027-01-01T00:01:00Z');
    useChatUi.setState({ emotionChangedAt: now - 3_000 });
    renderApp(<MyEmotionPanel eventId={EV} />, now);
    const save = screen.getByRole('button', { name: /Зберегти · можна через \d+ с/ });
    expect(save).toBeDisabled();
  });
});
