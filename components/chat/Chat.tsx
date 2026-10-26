'use client';

/**
 * C9. Chat — читана частина чату (без поля введення: воно в US4). Кімната «Світ» (або «Країна», «Перший ряд»).
 * Стани: `live` (нові внизу, автопрокрутка), `paused` (стрічку зупинено: прокрутка вгору, «Пауза чату» або фокус у списку;
 * капсула «Нові повідомлення N ↓»), `l` (скелетони), `empty`, `unavailable`.
 * Доступність: обгортка `role="log"` з `aria-live="polite"`, сам `<ol>` — список; один Tab-стоп із рухомим фокусом
 * (нік повідомлення), ↑/↓/Home/End переходять між авторами, Enter відкриває O-AUTHOR. Лічильник нових на вкладці
 * не є live-областю (оголошення «Нові повідомлення» — справа сторінки, не частіше ніж раз на 30 с).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Skeleton } from '@/components/primitives/Skeleton';
import type { Author, ChatMessage, RoomId } from '@/lib/data/types';
import { Message, type MessageLookup } from './Message';

export type ChatState = 'live' | 'l' | 'empty' | 'unavailable';

export interface ChatProps {
  /** Кімната: `world` («Світ»), `country:FR`, `firstrow:<eventId>`. */
  room: { id: RoomId; label: string };
  messages: readonly ChatMessage[];
  /** `live` за замовчуванням; `l` — скелетони; `empty` — нічого немає; `unavailable` — чат недоступний. */
  state?: ChatState;
  lookup?: MessageLookup;
  /** Дотик до ніка / Enter (O-AUTHOR). */
  onAuthorOpen?: (author: Author) => void;
  /** Є — показуємо кнопку «Сховати чат». */
  onHide?: () => void;
  /** Для `unavailable`: «До подій». */
  onToEvents?: () => void;
  /** Початковий стан паузи (кнопка «Пауза чату»). */
  defaultPaused?: boolean;
  /** Перемикач кімнат («Світ» / «Країна», сторінка країни) замість назви кімнати в шапці. */
  roomSwitcher?: ReactNode;
  className?: string;
}

const NEAR_BOTTOM = 24;

export function Chat({ room, messages, state = 'live', lookup, onAuthorOpen, onHide, onToEvents, defaultPaused = false, roomSwitcher, className }: ChatProps) {
  const t = useTranslations('chat');
  const common = useTranslations('common');

  const logRef = useRef<HTMLDivElement>(null);
  const [manualPause, setManualPause] = useState(defaultPaused);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const visible = useMemo(() => messages.filter((m) => m.moderation !== 'hidden' || m.author?.isMine), [messages]);
  const paused = manualPause || scrolledUp || focusInside;

  // Автопрокрутка вниз, поки стрічка не зупинена.
  useEffect(() => {
    if (paused) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length, paused, state]);

  // Скільки повідомлень прийшло відтоді, як стрічку зупинено (поки не на паузі — відлік іде за кінцем списку).
  const [baseline, setBaseline] = useState(visible.length);
  if (!paused && baseline !== visible.length) setBaseline(visible.length);
  const newCount = paused ? Math.max(0, visible.length - baseline) : 0;

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    setScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM);
  }, []);

  const jumpToEnd = () => {
    setManualPause(false);
    setScrolledUp(false);
    setFocusInside(false);
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Єдиний Tab-стоп: останній сфокусований автор, інакше найновіше повідомлення з автором.
  const authored = visible.filter((m) => m.kind === 'regular' && m.author);
  const stopId = authored.some((m) => m.id === activeId) ? activeId : (authored[authored.length - 1]?.id ?? null);

  const onAuthorKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const root = logRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-chat-author]')];
    const i = items.indexOf(e.currentTarget);
    if (i === -1) return;
    const next = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'Home' ? 0 : items.length - 1;
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  const emptyText = room.id.startsWith('firstrow:') ? t('emptyFirstRow') : t('emptyCountry');

  return (
    <div data-chat={state} data-room={room.id} className={cn('flex min-h-0 flex-col bg-background', className)}>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border ps-3 pe-1">
        {roomSwitcher ?? (
          <span
            aria-label={`${t('title')}: ${room.label}`}
            className="inline-flex h-7.5 items-center rounded-full bg-surface-raised px-3.5 text-caption font-semibold text-text"
          >
            {room.label}
          </span>
        )}
        <span className="flex-1" />
        <IconButton
          icon={manualPause ? 'play' : 'pause'}
          variant="toggle"
          aria-label={t('pause')}
          pressed={manualPause}
          onPressedChange={setManualPause}
          disabled={state !== 'live'}
        />
        {onHide ? <IconButton icon="close" variant="plain" aria-label={t('hide')} onClick={onHide} /> : null}
      </div>

      {state === 'unavailable' ? (
        <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" data-row="unavailable">
          <Icon name="wifi-off" size={22} className="text-text-secondary" />
          <p className="text-body text-text">{t('unavailable')}</p>
          {onToEvents ? (
            <Button variant="secondary" onClick={onToEvents}>
              {t('toEvents')}
            </Button>
          ) : null}
        </div>
      ) : state === 'l' ? (
        <div aria-busy="true" className="flex flex-1 flex-col justify-end gap-4 overflow-hidden px-3.5 py-3" data-row="loading">
          <span className="sr-only" role="status">
            {common('loading')}
          </span>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="chat-line" />
          ))}
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={t('logLabel', { room: room.label })}
            tabIndex={authored.length === 0 ? 0 : undefined}
            onScroll={onScroll}
            onFocus={() => setFocusInside(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusInside(false);
            }}
            className="t2f-focus min-h-0 flex-1 overflow-y-auto"
          >
            {visible.length === 0 || state === 'empty' ? (
              <p className="p-6 text-center text-body text-text-secondary" data-row="empty">
                {emptyText}
              </p>
            ) : (
              <ol className="flex min-h-full list-none flex-col justify-end gap-2 px-3.5 py-1">
                {visible.map((m) => (
                  <Message
                    key={m.id}
                    message={m}
                    lookup={lookup}
                    tabStop={m.id === stopId}
                    onAuthorOpen={onAuthorOpen}
                    onAuthorFocus={() => setActiveId(m.id)}
                    onAuthorKeyDown={onAuthorKeyDown}
                  />
                ))}
              </ol>
            )}
          </div>
          {paused ? (
            <div className="flex shrink-0 flex-col items-center gap-1 px-3 pb-2" data-row="paused">
              <p className="text-caption text-text-muted">{t('pausedNote')}</p>
              {newCount > 0 ? (
                <Button variant="secondary" compact iconRight="arrow-down" onClick={jumpToEnd} className="bg-background">
                  {t('newMessages')} {newCount}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
