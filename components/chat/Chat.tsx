'use client';

/**
 * C9. Chat — шапка, стрічка й місце під поле введення (`composer`). Кімната «Світ» (або «Країна»).
 * Стани: `live` (нові внизу, автопрокрутка), `paused` (стрічку зупинено: прокрутка вгору, «Пауза чату» або фокус у списку;
 * капсула «Нові повідомлення N ↓»), `l` (скелетони), `empty`, `unavailable`.
 * Доступність: обгортка `role="log"` з `aria-live="polite"`, сам `<ol>` — список; один Tab-стоп із рухомим фокусом
 * (нік повідомлення), ↑/↓/Home/End переходять між авторами, Enter відкриває O-AUTHOR. Лічильник нових на вкладці
 * не є live-областю (оголошення «Нові повідомлення» — справа сторінки, не частіше ніж раз на 30 с).
 *
 * Файл — композиція: меню повідомлення — `useChatMenu`, налаштування/правила на місці стрічки — `useChatSettingsPanel`,
 * прокрутка й пауза — `useChatLogScroll`, Tab-стоп авторів — `useChatAuthorStop`; шапка — `ChatHeader`,
 * список — `ChatFeed`, службові стани — `ChatStates`.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { Author, ChatMessage, RoomId } from '@/lib/data/types';
import type { MessageLookup } from './parts/Message';
import type { MessageActionHandlers } from './parts/MessageActions';
import { useChatDockContext } from './ChatDock';
import { ChatFeed } from './parts/ChatFeed';
import { ChatHeader } from './parts/ChatHeader';
import { MessageMenu } from './parts/MessageMenu';
import { ChatRules } from './parts/ChatRules';
import { ChatEmpty, ChatLoading, ChatUnavailable } from './parts/ChatStates';
import { useChatAuthorStop } from './hooks/useChatAuthorStop';
import { useChatLogScroll } from './hooks/useChatLogScroll';
import { useChatMenu } from './hooks/useChatMenu';
import { useChatSettingsPanel } from './hooks/useChatSettingsPanel';

export type ChatState = 'live' | 'l' | 'empty' | 'unavailable';

export interface ChatProps {
  /** Кімната: `world` («Світ») або `country:FR`. */
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
  /** Кнопки шапки між перемикачем і «Паузою». */
  headerExtra?: ReactNode;
  /** Поле введення під стрічкою (C11). */
  composer?: ReactNode;
  /** Порожня кімната (макет `Phone-Country-Chat`): прапор країни в колі й рядок під заголовком. */
  emptyInfo?: { flagCode?: string; sub?: ReactNode };
  /** Смуга між шапкою й стрічкою (напр. «Немає з’єднання», нота кімнати). */
  banner?: ReactNode;
  /** «Правила чату» в меню «Ще дії чату»; без нього меню немає (коли немає `settings`). */
  onRules?: () => void;
  /**
   * «⋯» → «Налаштування чату» на місці стрічки (рішення власника 2026-10-30): кімнати й поле введення лишаються,
   * «⋯» підсвічена; ще раз «⋯», Esc чи надіслане своє повідомлення — назад до стрічки.
   */
  settings?: (api: { titleRef: RefObject<HTMLHeadingElement | null>; id: string; openRules: () => void }) => ReactNode;
  /** Дії над повідомленням: «⋯» відкриває меню в шарі чату; `menuAlways` — телефон (кнопка завжди видна). Без значення дій немає. */
  messageActions?: MessageActionHandlers & { menuAlways?: boolean };
  /** Нове повідомлення «ввічливо» оголошується не частіше ніж раз на 30 с. */
  announceNew?: boolean;
  className?: string;
}

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
  emptyInfo,
  banner,
  onRules,
  settings,
  messageActions,
  announceNew = false,
  className,
}: ChatProps) {
  const t = useTranslations('chat');
  const { toVideo } = useChatDockContext();

  const logRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => messages.filter((m) => m.moderation !== 'hidden' || m.author?.isMine),
    [messages],
  );
  const deletedIds = useMemo(() => new Set(messages.filter((m) => m.deleted).map((m) => m.id)), [messages]);

  const { menu, menuMessage, openMenu, closeMenu } = useChatMenu(visible, wrapRef, logRef);
  const {
    panel,
    setPanel,
    settingsOpen,
    setSettingsOpen,
    openRulesPanel,
    dotsRef,
    settingsTitleRef,
    settingsId,
    closeSettings,
    settingsBoxRef,
  } = useChatSettingsPanel(room.id, visible);
  // Телефон (вікно чату внизу): меню стоїть у потоці стрічки просто під повідомленням.
  const inlineMenu = collapseMode || !!messageActions?.menuAlways;
  const { manualPause, setManualPause, scrolledUp, setFocusInside, paused, newCount, onScroll, jumpToUnseen } =
    useChatLogScroll({
      logRef,
      state,
      visible,
      roomId: room.id,
      defaultPaused,
      announceNew,
      menu,
      menuMessage,
      inlineMenu,
    });

  const { authoredCount, stopId, setActiveId, onAuthorKeyDown } = useChatAuthorStop(visible, logRef);

  const down = state === 'unavailable';

  return (
    <div data-chat={state} data-room={room.id} className={cn('flex min-h-0 flex-col', className)}>
      {down ? null : (
      <ChatHeader
        roomLabel={room.label}
        roomSwitcher={roomSwitcher}
        headerExtra={headerExtra}
        collapseMode={collapseMode}
        manualPause={manualPause}
        pauseDisabled={state !== 'live'}
        onTogglePause={() => setManualPause((v) => !v)}
        toVideo={toVideo}
        onHide={onHide}
        hasSettings={!!settings}
        dotsRef={dotsRef}
        settingsOpen={settingsOpen}
        settingsId={settingsId}
        onSettingsToggle={() => {
          closeMenu();
          if (settingsOpen) closeSettings();
          else setSettingsOpen(true);
        }}
        onRules={onRules}
      />
      )}
      {!down && !settingsOpen && (manualPause || (scrolledUp && !(inlineMenu && menuMessage))) ? (
        <p role="status" className="t2f-chat-pausednote" data-row="paused">
          <Icon name="pause" size={14} strokeWidth={2} />
          {t('pausedNote')}
        </p>
      ) : null}
      {down ? null : banner}

      {state === 'unavailable' ? (
        <ChatUnavailable onHide={onHide} onToEvents={onToEvents} collapseMode={collapseMode} />
      ) : state === 'l' ? (
        <ChatLoading />
      ) : settings && settingsOpen ? (
        <div ref={settingsBoxRef} className="relative flex min-h-0 flex-1 flex-col">
          {panel === 'rules' ? (
            <ChatRules
              id={settingsId}
              titleRef={settingsTitleRef}
              fromSettings
              onBack={() => setPanel('settings')}
              onDone={() => closeSettings()}
            />
          ) : null}
          {panel === 'settings' && settings({ titleRef: settingsTitleRef, id: settingsId, openRules: openRulesPanel })}
        </div>
      ) : (
        <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label={t('logLabel', { room: room.label })}
            tabIndex={authoredCount === 0 ? 0 : undefined}
            onScroll={onScroll}
            onFocus={() => setFocusInside(true)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusInside(false);
            }}
            className="t2f-focus t2f-chat-log min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
          >
            {visible.length === 0 || state === 'empty' ? (
              <ChatEmpty emptyInfo={emptyInfo} />
            ) : (
              <ChatFeed
                visible={visible}
                deletedIds={deletedIds}
                lookup={lookup}
                stopId={stopId}
                onAuthorOpen={onAuthorOpen}
                onAuthorFocus={setActiveId}
                onAuthorKeyDown={onAuthorKeyDown}
                messageActions={messageActions}
                openMenu={openMenu}
                closeMenu={closeMenu}
                menu={menu}
                menuMessage={menuMessage}
                inlineMenu={inlineMenu}
              />
            )}
          </div>
          {/* Пауза (`Phone-Chat-Paused`): лише «Нові повідомлення N ↓» поверх стрічки (absolute) — висота не змінюється. */}
          {menu && menuMessage && !inlineMenu ? (
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
              onTranslateLocked={messageActions?.onTranslateLocked}
            />
          ) : null}
          {paused && !(manualPause || scrolledUp) ? (
            <p role="status" className="sr-only" data-row="paused">
              {t('pausedNote')}
            </p>
          ) : null}
          {paused && newCount > 0 && !(inlineMenu && menuMessage) ? (
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
