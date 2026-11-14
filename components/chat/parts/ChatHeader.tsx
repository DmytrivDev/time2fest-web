'use client';

/**
 * Шапка `Chat`: перемикач кімнат (або назва), кнопки «Пауза», «До відео», «Сховати/Згорнути чат», «⋯»
 * (налаштування чату або меню з «Правилами»). Частина `Chat`.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';

export function ChatHeader({
  roomLabel,
  roomSwitcher,
  headerExtra,
  collapseMode,
  manualPause,
  pauseDisabled,
  onTogglePause,
  toVideo,
  onHide,
  hasSettings,
  dotsRef,
  settingsOpen,
  settingsId,
  onSettingsToggle,
  onRules,
}: {
  roomLabel: string;
  roomSwitcher?: ReactNode;
  headerExtra?: ReactNode;
  collapseMode: boolean;
  manualPause: boolean;
  pauseDisabled: boolean;
  onTogglePause: () => void;
  toVideo: (() => void) | null;
  onHide?: () => void;
  hasSettings: boolean;
  dotsRef: Ref<HTMLButtonElement>;
  settingsOpen: boolean;
  settingsId: string;
  onSettingsToggle: () => void;
  onRules?: () => void;
}) {
  const t = useTranslations('chat');
  return (
    <div
      className={cn(
        't2f-chat-head flex shrink-0 items-center border-b border-border ps-3 pe-2',
        collapseMode ? 'h-12' : 'h-13',
      )}
      {...(collapseMode ? { 'data-dock-grip': '' } : {})}
    >
      {roomSwitcher ?? (
        <span
          aria-label={`${t('title')}: ${roomLabel}`}
          className="inline-flex h-7.5 items-center rounded-full bg-surface-raised px-3.5 text-caption font-semibold text-text"
        >
          {roomLabel}
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
        disabled={pauseDisabled}
        onClick={onTogglePause}
        className="t2f-focus t2f-chat-hbtn"
      >
        <span aria-hidden="true">
          <Icon name="pause" size={manualPause ? 16 : 18} strokeWidth={manualPause ? 2.4 : 2} />
        </span>
      </button>
      {collapseMode && toVideo ? (
        <button
          type="button"
          onClick={toVideo}
          className="t2f-focus t2f-chat-tovideo"
          data-chat-to-video=""
        >
          <span>
            <Icon name="chevron-up" size={16} strokeWidth={2.2} />
            {t('toVideo')}
          </span>
        </button>
      ) : null}
      {onHide ? (
        <button
          type="button"
          aria-label={collapseMode ? t('collapse') : t('hide')}
          onClick={onHide}
          className="t2f-focus t2f-chat-hbtn"
          {...(collapseMode ? { 'data-chat-collapse': '' } : {})}
        >
          <span aria-hidden="true">
            <Icon
              name={collapseMode ? 'chevron-down' : 'chevrons-right'}
              size={18}
              strokeWidth={2}
            />
          </span>
        </button>
      ) : null}
      {hasSettings ? (
        <button
          ref={dotsRef}
          type="button"
          aria-label={t('settings.open')}
          aria-expanded={settingsOpen}
          aria-controls={settingsOpen ? settingsId : undefined}
          onClick={onSettingsToggle}
          className="t2f-focus t2f-chat-hbtn"
          data-chat-settings-toggle=""
          data-active={settingsOpen ? 'true' : undefined}
        >
          <span aria-hidden="true">
            <Icon name="more" size={18} />
          </span>
        </button>
      ) : onRules ? (
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
  );
}
