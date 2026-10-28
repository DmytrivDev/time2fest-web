import { fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Chat } from '@/components/chat/Chat';
import { Message, type MessageLookup } from '@/components/chat/Message';
import type { Author, ChatMessage } from '@/lib/data/types';
import { renderApp, wrap } from './render';

const COUNTRIES = {
  AU: { iso: 'AU', name: { uk: 'Австралія' }, gender: 'f' as const },
  FR: { iso: 'FR', name: { uk: 'Франція' }, gender: 'f' as const },
  DE: { iso: 'DE', name: { uk: 'Німеччина' }, gender: 'n' as const },
  IT: { iso: 'IT', name: { uk: 'Італія' }, gender: 'f' as const },
  UK: { iso: 'UA', name: { uk: 'Україна' }, gender: 'f' as const },
};
const FLAG_NAMES: Record<string, string> = { AU: 'Австралія', CA: 'Канада', GB: 'Велика Британія', UA: 'Україна' };
const lookup: MessageLookup = {
  countryName: (code) => FLAG_NAMES[code],
  country: (iso) => (COUNTRIES as Record<string, { name: { uk: string }; gender: 'f' | 'n' }>)[iso],
  cityName: (id) => ({ london: 'Лондон' })[id],
};

const T = Date.parse('2027-01-01T01:36:00Z');
const LIAM: Author = { id: 'u1', nick: 'Liam', flagCode: 'AU', badges: [] };
const AMIRA: Author = { id: 'u2', nick: 'Аміра', flagCode: 'CA', badges: ['pass'] };
const JAMES: Author = { id: 'u3', nick: 'James', flagCode: 'GB', badges: ['first-row'], firstRowEmojiId: 'confetti' };
const ME: Author = { id: 'me', nick: 'Мирон', flagCode: 'UA', badges: [], isMine: true };

let seq = 0;
const msg = (over: Partial<ChatMessage>): ChatMessage => {
  seq += 1;
  return { id: `m${seq}`, room: 'world', kind: 'regular', createdAt: T + seq * 1000, moderation: 'ok', ...over };
};
const regular = (author: Author, text: string, over: Partial<ChatMessage> = {}) => msg({ kind: 'regular', author, text, ...over });

function inList(ui: ReactElement) {
  return renderApp(<ol>{ui}</ol>);
}

describe('Message', () => {
  it('regular: нік — одна ціль дотику з назвою «Аміра, Канада»; текст і час', () => {
    const onOpen = vi.fn();
    inList(<Message message={regular(AMIRA, 'Привіт з Торонто!')} lookup={lookup} onAuthorOpen={onOpen} />);
    const nick = screen.getByRole('button', { name: 'Аміра, Канада' });
    expect(nick).toHaveTextContent('Аміра');
    fireEvent.click(nick);
    expect(onOpen).toHaveBeenCalledWith(AMIRA);
    expect(screen.getByText('Привіт з Торонто!')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Новорічний пас' })).toBeInTheDocument();
    expect(document.querySelector('time')).not.toBeNull();
  });

  it('позначки не клікабельні: єдина кнопка в рядку — нік', () => {
    inList(<Message message={regular(JAMES, 'The Thames is packed!')} lookup={lookup} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('Перший ряд')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'емоція: Хлопавка' })).toBeInTheDocument();
  });

  it('own: «це ти»; відповідь: цитата', () => {
    inList(<Message message={regular(ME, 'Вітаю!', { replyTo: { id: 'x', nick: 'Liam', excerpt: 'hi' } })} lookup={lookup} />);
    expect(screen.getByText('Ти')).toBeInTheDocument();
    expect(screen.getByText('Відповідь · Liam')).toBeInTheDocument();
  });

  it('system country-midnight: «Франція, Німеччина й Італія зустріли Новий рік» через metPhrase', () => {
    inList(
      <Message
        message={msg({
          kind: 'system',
          system: {
            kind: 'country-midnight',
            countries: [
              { iso: 'FR', gender: 'f' },
              { iso: 'DE', gender: 'n' },
              { iso: 'IT', gender: 'f' },
            ],
            eventIds: [],
          },
        })}
        lookup={lookup}
      />,
    );
    expect(screen.getByText('Франція, Німеччина й Італія зустріли Новий рік')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Time2Fest' })).toBeInTheDocument();
  });

  it('system country-midnight: одна країна — дієслово за родом', () => {
    inList(
      <Message
        message={msg({ kind: 'system', system: { kind: 'country-midnight', countries: [{ iso: 'AU', gender: 'f' }], eventIds: [] } })}
        lookup={lookup}
      />,
    );
    expect(screen.getByText('Австралія зустріла Новий рік')).toBeInTheDocument();
  });

  it('system country-midnight: рід невідомий — «Країна · Новий рік настав»', () => {
    inList(
      <Message
        message={msg({ kind: 'system', system: { kind: 'country-midnight', countries: [{ iso: 'ZZ', gender: null }], eventIds: [] } })}
        lookup={{ country: () => ({ name: { uk: 'Країна' }, gender: null }) }}
      />,
    );
    expect(screen.getByText('Країна · Новий рік настав')).toBeInTheDocument();
  });

  it('system firstrow-joined і лічильник привітань', () => {
    inList(
      <>
        <Message
          message={msg({ kind: 'system', system: { kind: 'firstrow-joined', participantName: 'Олена і друзі', flagCode: 'UA', eventId: 'e', cityId: 'london' } })}
          lookup={lookup}
        />
        <Message message={msg({ kind: 'system', system: { kind: 'greetings-counter', count: 1240, flagCodes: ['GB', 'FR'], eventId: 'e' } })} lookup={lookup} />
      </>,
    );
    expect(screen.getByText(/тепер у першому ряду · Лондон/)).toBeInTheDocument();
    expect(screen.getByText(/\+1\s240 людей привітали/)).toBeInTheDocument();
  });

  it('greeting: «Time2Fest вітає з Новим роком: James … — Перший ряд · Лондон, місце 2» і привітання в лапках', () => {
    const { container } = inList(
      <Message
        message={msg({
          kind: 'greeting',
          greeting: { eventId: 'e', seat: 2, participantName: 'James', flagCode: 'GB', emojiId: 'confetti', cityId: 'london', text: 'Happy New Year!' },
        })}
        lookup={lookup}
      />,
    );
    const card = container.querySelector('[data-kind="greeting"]')!;
    expect(card).toHaveTextContent('Time2Fest вітає з Новим роком: James');
    expect(card).toHaveTextContent('Перший ряд · Лондон, місце 2');
    expect(card).toHaveTextContent('«Happy New Year!»');
    expect(card.className).toMatch(/border-highlight/);
    expect(within(card as HTMLElement).getByRole('img', { name: 'емоція: Хлопавка' })).toBeInTheDocument();
  });

  it('приховане модерацією бачить лише автор', () => {
    const hidden = regular(ME, 'x', { moderation: 'hidden' });
    const { container, unmount } = inList(<Message message={hidden} lookup={lookup} />);
    expect(screen.getByText('Повідомлення приховано правилами чату')).toBeInTheDocument();
    unmount();
    const other = inList(<Message message={regular(LIAM, 'x', { moderation: 'hidden' })} lookup={lookup} />);
    expect(other.container.querySelector('li')).toBeNull();
    expect(container).toBeDefined();
  });
});

describe('Chat', () => {
  const messages = [regular(LIAM, 'one'), regular(AMIRA, 'two'), regular(JAMES, 'three'), regular(ME, 'four')];
  const room = { id: 'world' as const, label: 'Світ' };

  it('role=log з aria-live, список усередині, кімната «Світ»', () => {
    renderApp(<Chat room={room} messages={messages} lookup={lookup} />);
    const log = screen.getByRole('log', { name: 'Повідомлення чату «Світ»' });
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(within(log).getByRole('list')).toBeInTheDocument();
    expect(within(log).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByLabelText('Чат: Світ')).toBeInTheDocument();
  });

  it('один Tab-стоп: лише найновіший автор має tabindex=0', () => {
    renderApp(<Chat room={room} messages={messages} lookup={lookup} />);
    const nicks = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-chat-author'));
    expect(nicks).toHaveLength(4);
    expect(nicks.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(nicks[3]!.tabIndex).toBe(0);
  });

  it('стрілки переходять між авторами, Home/End — на межі; Tab-стоп слідує за фокусом', () => {
    renderApp(<Chat room={room} messages={messages} lookup={lookup} />);
    const nicks = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-chat-author'));
    nicks[3]!.focus();
    fireEvent.keyDown(nicks[3]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(nicks[2]);
    fireEvent.keyDown(nicks[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(nicks[0]);
    expect(nicks[0]!.tabIndex).toBe(0);
    expect(nicks[3]!.tabIndex).toBe(-1);
    fireEvent.keyDown(nicks[0]!, { key: 'End' });
    expect(document.activeElement).toBe(nicks[3]);
  });

  it('Enter на ніку відкриває O-AUTHOR (клік)', () => {
    const onOpen = vi.fn();
    renderApp(<Chat room={room} messages={messages} lookup={lookup} onAuthorOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Аміра, Канада' }));
    expect(onOpen).toHaveBeenCalledWith(AMIRA, expect.objectContaining({ kind: 'regular' }));
  });

  it('стан l: скелетони, aria-busy, без списку', () => {
    const { container } = renderApp(<Chat room={room} messages={[]} state="l" />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Завантажуємо');
  });

  it('порожня кімната країни й «Перший ряд»', () => {
    const a = renderApp(<Chat room={{ id: 'country:FR', label: 'Франція' }} messages={[]} />);
    expect(screen.getByText('Тут поки тихо — привітай першим')).toBeInTheDocument();
    a.unmount();
    renderApp(<Chat room={{ id: 'firstrow:e1', label: 'Перший ряд' }} messages={[]} />);
    expect(screen.getByText('Ти перший у першому ряду — привітай тих, хто прийде')).toBeInTheDocument();
  });

  it('недоступний: заголовок, друга лінія, без шапки з чипами; «Згорнути чат» на телефоні', () => {
    const onHide = vi.fn();
    renderApp(
      <Chat room={room} messages={[]} state="unavailable" collapseMode onHide={onHide} roomSwitcher={<span>чипи</span>} composer={<textarea />} />,
    );
    expect(screen.getByRole('heading', { name: 'Чат тимчасово недоступний, повернемося за хвилину' })).toBeInTheDocument();
    expect(screen.getByText('Трансляція й «Події» працюють як звичайно.')).toBeInTheDocument();
    expect(screen.queryByText('чипи')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Пауза чату' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Згорнути чат' }));
    expect(onHide).toHaveBeenCalled();
  });

  it('недоступний, десктоп: кнопка «Сховати чат»', () => {
    const onHide = vi.fn();
    renderApp(<Chat room={room} messages={[]} state="unavailable" onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сховати чат' }));
    expect(onHide).toHaveBeenCalled();
  });

  it('«Пауза чату» — перемикач; на паузі видно примітку', () => {
    renderApp(<Chat room={room} messages={messages} lookup={lookup} />);
    const pause = screen.getByRole('button', { name: 'Пауза чату' });
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Стрічку зупинено — читай у своєму темпі')).toBeNull();
    fireEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Стрічку зупинено — читай у своєму темпі')).toBeInTheDocument();
  });

  it('на паузі нові повідомлення рахуються в капсулі «Нові повідомлення N»', () => {
    const { rerender } = renderApp(<Chat room={room} messages={messages} lookup={lookup} defaultPaused />);
    expect(screen.queryByRole('button', { name: /Нові повідомлення/ })).toBeNull();
    const more = [...messages, regular(LIAM, 'five'), regular(AMIRA, 'six')];
    rerender(wrap(<Chat room={room} messages={more} lookup={lookup} defaultPaused />));
    expect(screen.getByRole('button', { name: /Нові повідомлення 2/ })).toBeInTheDocument();
  });

  it('«Сховати чат» лише якщо передано onHide', () => {
    const { unmount } = renderApp(<Chat room={room} messages={messages} lookup={lookup} />);
    expect(screen.queryByRole('button', { name: 'Сховати чат' })).toBeNull();
    unmount();
    const onHide = vi.fn();
    renderApp(<Chat room={room} messages={messages} lookup={lookup} onHide={onHide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сховати чат' }));
    expect(onHide).toHaveBeenCalled();
  });
});

