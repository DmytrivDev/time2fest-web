'use client';

/**
 * C9. Chat — шапка, стрічка й місце під поле введення (`composer`). Кімната «Світ» (або «Країна», «Перший ряд»).
 * Стани: `live` (нові внизу, автопрокрутка), `paused` (стрічку зупинено: прокрутка вгору, «Пауза чату» або фокус у списку;
 * капсула «Нові повідомлення N ↓»), `l` (скелетони), `empty`, `unavailable`.
 * Доступність: обгортка `role="log"` з `aria-live="polite"`, сам `<ol>` — список; один Tab-стоп із рухомим фокусом
 * (нік повідомлення), ↑/↓/Home/End переходять між авторами, Enter відкриває O-AUTHOR. Лічильник нових на вкладці
 * не є live-областю (оголошення «Нові повідомлення» — справа сторінки, не частіше ніж раз на 30 с).
 */
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Skeleton } from '@/components/primitives/Skeleton';
import type { Author, ChatMessage, RoomId } from '@/lib/data/types';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { Message, type MessageLookup } from './Message';
import type { MessageActionHandlers } from './MessageActions';
import { MessageMenu } from './MessageMenu';

const SCROLL_MS = 250;
const SCROLL_PAD = 8;

export type ChatState = 'live' | 'l' | 'empty' | 'unavailable';

export interface ChatProps {
  /** Кімната: `world` («Світ»), `country:FR`, `firstrow:<eventId>`. */
  room: { id: RoomId; label: string };
  messages: readonly ChatMessage[];
  /** `live` за замовчуванням; `l` — скелетони; `empty` — нічого немає; `unavailable` — чат недоступний. */
  state?: ChatState;
  lookup?: MessageLookup;
  /** Дотик до ніка / Enter (O-AUTHOR). */
  onAuthorOpen?: (author: Author, message: ChatMessage) => void;
  /** Є — показуємо кнопку «Сховати чат» (на телефоні з `collapseMode` — «Згорнути чат»). */
  onHide?: () => void;
  /** Телефон, закріплене вікно: кнопка «Згорнути чат» (шеврон вниз), шапка 48 px, зона жестів. */
  collapseMode?: boolean;
  /** Для `unavailable`: «До подій». */
  onToEvents?: () => void;
  /** Початковий стан паузи (кнопка «Пауза чату»). */
  defaultPaused?: boolean;
  /** Перемикач кімнат («Світ» / «Країна», сторінка країни) замість назви кімнати в шапці. */
  roomSwitcher?: ReactNode;
  /** Кнопки шапки між перемикачем і «Паузою» (напр. «Моя емоція» кімнати «Перший ряд»). */
  headerExtra?: ReactNode;
  /** Поле введення під стрічкою (C11). */
  composer?: ReactNode;
  /** Смуга між шапкою й стрічкою (напр. «Немає з’єднання», нота кімнати). */
  banner?: ReactNode;
  /** «Правила чату» в меню «Ще дії чату»; без нього меню немає. */
  onRules?: () => void;
  /** Дії над повідомленням: «⋯» відкриває меню в шарі чату; `menuAlways` — телефон (кнопка завжди видна). Без значення дій немає. */
  messageActions?: MessageActionHandlers & { menuAlways?: boolean };
  /** Нове повідомлення «ввічливо» оголошується не частіше ніж раз на 30 с. */
  announceNew?: boolean;
  className?: string;
}

const NEAR_BOTTOM = 24;

export function Chat({
  room,
  messages,
  state = 'live',
  lookup,
  onAuthorOpen,
  onHide,
  collapseMode = false,
  onToEvents,
  defaultPaused = false,
  roomSwitcher,
  headerExtra,
  composer,
  banner,
  onRules,
  messageActions,
  announceNew = false,
  className,
}: ChatProps) {
  const t = useTranslations('chat');
  const common = useTranslations('common');
  const announce = useAnnounce();

  const logRef = useRef<HTMLDivElement>(null);
  const [manualPause, setManualPause] = useState(defaultPaused);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    message: ChatMessage;
    anchor: HTMLElement;
    container: HTMLElement;
    scroller: HTMLElement;
  } | null>(null);

  const visible = useMemo(
    () => messages.filter((m) => m.moderation !== 'hidden' || m.author?.isMine),
    [messages],
  );

  // Меню «⋯»: перемикається тією ж кнопкою; зникає разом із повідомленням.
  const openMenu = useCallback((message: ChatMessage, trigger: HTMLElement) => {
    const anchor = trigger.closest<HTMLElement>('[data-msg-id]');
    const container = wrapRef.current;
    const scroller = logRef.current;
    if (!anchor || !container || !scroller) return;
    setMenu((cur) =>
      cur?.message.id === message.id ? null : { message, anchor, container, scroller },
    );
  }, []);
  const closeMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setMenu((cur) => {
      if (cur && opts?.restoreFocus)
        cur.anchor.querySelector<HTMLElement>('[data-msg-trigger]')?.focus();
      return null;
    });
  }, []);
  const menuMessage = menu ? (visible.find((m) => m.id === menu.message.id) ?? null) : null;
  const paused = manualPause || scrolledUp || focusInside || menuMessage !== null;

  const lastId = visible[visible.length - 1]?.id;
  // Автопрокрутка вниз, поки стрічка не зупинена.
  useEffect(() => {
    if (paused) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // Останнє повідомлення, а не довжина: коли стрічка досягла ліміту, довжина лишається сталою.
  }, [lastId, paused, state]);

  // Скільки повідомлень прийшло відтоді, як стрічку зупинено (поки не на паузі — відлік іде за кінцем списку).
  // Побачене (верх повідомлення у вікні стрічки) стає прочитаним: лічильник зменшується, а коли непрочитаних нижче
  // не лишилось — капсула зникає (рішення власника: не лише в самому низу).
  const [baseline, setBaseline] = useState(visible.length);
  if (!paused && baseline !== visible.length) setBaseline(visible.length);
  const markSeen = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const bottom = el.getBoundingClientRect().bottom - 4;
    setBaseline((base) => {
      let next = base;
      for (let i = base; i < visible.length; i += 1) {
        const node = el.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(visible[i]!.id)}"]`);
        if (!node || node.getBoundingClientRect().top > bottom) break;
        next = i + 1;
      }
      return next;
    });
  }, [visible]);
  useLayoutEffect(() => {
    if (paused) markSeen();
  }, [paused, markSeen]);
  const newCount = paused ? Math.max(0, visible.length - baseline) : 0;

  // Лічильник нових на вкладці не є live-областю: оголошення «Нові повідомлення N» — не частіше ніж раз на 30 с.
  const lastAnnounce = useRef(0);
  useEffect(() => {
    if (!announceNew || newCount === 0) return;
    const at = Date.now();
    if (at - lastAnnounce.current < 30_000) return;
    lastAnnounce.current = at;
    announce(`${t('newMessages')} ${newCount}`);
  }, [newCount, announceNew, announce, t]);

  // Зміна висоти стрічки (вікно чату на телефоні розгортається, з’являється напис паузи, екранна клавіатура) не є
  // прокруткою людини: коли стрічка була внизу, лишаємо її внизу, а «прокрутка» від стиснення не зупиняє стрічку.
  const noMessages = visible.length === 0;
  const pinned = useRef(true);
  const lastClientHeight = useRef(0);
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    let frame = 0;
    const pin = () => {
      if (pinned.current) {
        el.scrollTop = el.scrollHeight;
        setScrolledUp(false);
      }
    };
    const ro = new ResizeObserver(() => {
      pin();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pin);
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [state, noMessages]);

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    // Прокрутка від зміни висоти стрічки — не жест людини.
    const resized = el.clientHeight !== lastClientHeight.current;
    lastClientHeight.current = el.clientHeight;
    if (resized) {
      markSeen();
      return;
    }
    const up = el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM;
    pinned.current = !up;
    setScrolledUp(up);
    markSeen();
  }, [markSeen]);

  const reduceMotion = useReducedMotion();
  const scrollAnim = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollAnim.current), []);

  /** Швидка плавна прокрутка (≈250 мс); за «зменшити рух» — стрибок. */
  const scrollLogTo = (target: number) => {
    const el = logRef.current;
    if (!el) return;
    cancelAnimationFrame(scrollAnim.current);
    const to = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
    const from = el.scrollTop;
    if (reduceMotion || Math.abs(to - from) < 1) {
      el.scrollTop = to;
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / SCROLL_MS);
      el.scrollTop = from + (to - from) * (1 - (1 - k) ** 3);
      if (k < 1) scrollAnim.current = requestAnimationFrame(step);
    };
    scrollAnim.current = requestAnimationFrame(step);
  };

  // «Нові повідомлення N ↓»: до першого непобаченого повідомлення (рішення власника 2026-10-27).
  const jumpToUnseen = () => {
    setManualPause(false);
    setFocusInside(false);
    const el = logRef.current;
    const first = visible[baseline];
    const node = first
      ? el?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(first.id)}"]`)
      : null;
    if (!el) return;
    if (!node) {
      setScrolledUp(false);
      scrollLogTo(el.scrollHeight);
      return;
    }
    const offset = node.getBoundingClientRect().top - el.getBoundingClientRect().top;
    scrollLogTo(el.scrollTop + offset - SCROLL_PAD);
  };

  // Єдиний Tab-стоп: останній сфокусований автор, інакше найновіше повідомлення з автором.
  const authored = visible.filter((m) => m.kind === 'regular' && m.author);
  const stopId = authored.some((m) => m.id === activeId)
    ? activeId
    : (authored[authored.length - 1]?.id ?? null);

  const onAuthorKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const root = logRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-chat-author]')];
    const i = items.indexOf(e.currentTarget);
    if (i === -1) return;
    const next =
      e.key === 'ArrowUp'
        ? i - 1
        : e.key === 'ArrowDown'
          ? i + 1
          : e.key === 'Home'
            ? 0
            : items.length - 1;
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  const emptyText = room.id.startsWith('firstrow:') ? t('emptyFirstRow') : t('emptyCountry');

  return (
    <div data-chat={state} data-room={room.id} className={cn('flex min-h-0 flex-col', className)}>
      <div
        className={cn(
          't2f-chat-head flex shrink-0 items-center border-b border-border ps-3 pe-1',
          collapseMode ? 'h-12' : 'h-13',
        )}
        {...(collapseMode ? { 'data-dock-grip': '' } : {})}
      >
        {roomSwitcher ?? (
          <span
            aria-label={`${t('title')}: ${room.label}`}
            className="inline-flex h-7.5 items-center rounded-full bg-surface-raised px-3.5 text-caption font-semibold text-text"
          >
            {room.label}
          </span>
        )}
        <span className="flex-1" />
        {headerExtra}
        {/* Макети `Main` / `Phone-Chat`: іконки без кіл; ціль 44 px невидима, коло при наведенні — 30 px (висота «Світ»).
            На паузі (рішення власника) — жовта іконка «відтворити». */}
        <button
          type="button"
          aria-label={t('pause')}
          aria-pressed={manualPause}
          disabled={state !== 'live'}
          onClick={() => setManualPause((v) => !v)}
          className="t2f-focus t2f-chat-hbtn"
        >
          <span aria-hidden="true">
            <Icon name="pause" size={manualPause ? 16 : 18} strokeWidth={manualPause ? 2.4 : 2} />
          </span>
        </button>
        {onHide ? (
          <button
            type="button"
            aria-label={collapseMode ? t('collapse') : t('hide')}
            onClick={onHide}
            className="t2f-focus t2f-chat-hbtn"
            {...(collapseMode ? { 'data-chat-collapse': '' } : {})}
          >
            <span aria-hidden="true">
              <Icon name={collapseMode ? 'chevron-down' : 'chevrons-right'} size={18} strokeWidth={2} />
            </span>
          </button>
        ) : null}
        {onRules ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('moreActions')}
                className="t2f-focus t2f-chat-hbtn"
              >
                <span aria-hidden="true">
                  <Icon name="more" size={18} />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRules}>
                <Icon name="info" size={18} />
                {t('rules')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {manualPause || scrolledUp ? (
        <p role="status" className="t2f-chat-pausednote" data-row="paused">
          <Icon name="pause" size={14} strokeWidth={2} />
          {t('pausedNote')}
        </p>
      ) : null}
      {banner}

      {state === 'unavailable' ? (
        <div
          role="status"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-row="unavailable"
        >
          <Icon name="wifi-off" size={22} className="text-text-secondary" />
          <p className="text-body text-text">{t('unavailable')}</p>
          {onToEvents ? (
            <Button variant="secondary" onClick={onToEvents}>
              {t('toEvents')}
            </Button>
          ) : null}
        </div>
      ) : state === 'l' ? (
        <div
          aria-busy="true"
          className="flex flex-1 flex-col justify-end gap-4 overflow-hidden px-3.5 py-3"
          data-row="loading"
        >
          <span className="sr-only" role="status">
            {common('loading')}
          </span>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} variant="chat-line" />
          ))}
        </div>
      ) : (
        <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col">
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
            className="t2f-focus t2f-chat-log min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          >
            {visible.length === 0 || state === 'empty' ? (
              <p className="p-6 text-center text-body text-text-secondary" data-row="empty">
                {emptyText}
              </p>
            ) : (
              <ol className="t2f-chat-feed flex min-h-full list-none flex-col justify-end px-1.5 py-2">
                {visible.map((m) => (
                  <Message
                    key={m.id}
                    message={m}
                    lookup={lookup}
                    tabStop={m.id === stopId}
                    onAuthorOpen={onAuthorOpen ? (a) => onAuthorOpen(a, m) : undefined}
                    onAuthorFocus={() => setActiveId(m.id)}
                    onAuthorKeyDown={onAuthorKeyDown}
                    onReact={messageActions?.onReact}
                    onOpenMenu={messageActions ? openMenu : undefined}
                    menuOpen={menuMessage?.id === m.id}
                    menuAlways={messageActions?.menuAlways}
                  />
                ))}
              </ol>
            )}
          </div>
          {/* Пауза (`Phone-Chat-Paused`): лише «Нові повідомлення N ↓» поверх стрічки (absolute) — висота не змінюється. */}
          {menu && menuMessage ? (
            <MessageMenu
              key={menuMessage.id}
              message={menuMessage}
              anchor={menu.anchor}
              container={menu.container}
              scroller={menu.scroller}
              onClose={closeMenu}
              onReact={messageActions?.onReact}
              onReply={messageActions?.onReply}
              onMention={messageActions?.onMention}
              onReport={messageActions?.onReport}
            />
          ) : null}
          {paused && !(manualPause || scrolledUp) ? (
            <p role="status" className="sr-only" data-row="paused">
              {t('pausedNote')}
            </p>
          ) : null}
          {paused && newCount > 0 ? (
            <button
              type="button"
              onClick={jumpToUnseen}
              className="t2f-focus t2f-chat-newpill"
              data-row="new-messages"
            >
              {t('newMessages')} <span className="t2f-chat-newcount">{newCount}</span>
              <Icon name="arrow-down" size={16} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      )}
      {state === 'live' || state === 'empty' ? composer : null}
    </div>
  );
}
