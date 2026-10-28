'use client';

/**
 * C25 O-EMOJI — «Моя емоція» учасника «Першого ряду» (FR-054; рішення 2026-10-28, макети `Phone-Chat-FirstRow`, `Desk-Chat-FirstRow`).
 * `MyEmotionPill` — таблетка «Моя емоція» у рядку кімнати «Перший ряд» (видима 32 px, дотик 44). Відкриває вікно всередині чату
 * («‹ Назад · Моя емоція»): `MyEmotionPanel` — як тебе бачать на стіні, привітання до 80 символів, 16 емоцій, «Зберегти» / «Скасувати».
 * Вибір лише змінює попередній вигляд; «Зберегти» застосовує емоцію й привітання разом (раз на 10 с). Ім’я лише показується.
 * `EmojiPicker` — проста сітка вибору (історії).
 */
import { RadioGroup as Radix } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { RadioGroup } from '@/components/primitives/RadioGroup';
import { useOverlay } from '@/components/shell/OverlayManager';
import { canonicalEmotion, EMOTION_IDS } from '@/lib/firstrow/emotions';
import { useNow } from '@/lib/time/TimeProvider';
import { emotionWaitSec, useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';

/** 16 емодзі набору O-EMOJI у порядку на аркуші. */
export const EMOJI_PICKER_IDS = EMOTION_IDS;

export const EMOJI_WINDOW_ID = 'O-EMOJI';
export const GREETING_MAX = 80;

export interface EmojiPickerProps {
  value?: string;
  onSelect: (emojiId: string) => void;
  /** Скільки секунд лишилось до наступної зміни (0 — можна). */
  waitSec?: number;
  /** «Перший ряд · Лондон · місце 4». */
  seatLabel?: string;
  /** Що зараз на стіні («Олена і друзі» + емодзі). */
  onWall?: { name: string; emojiId: string };
  className?: string;
}

export function EmojiPicker({ value, onSelect, waitSec = 0, seatLabel, onWall, className }: EmojiPickerProps) {
  const t = useTranslations('windows.emoji');
  const c = useTranslations('chat');
  const names = useTranslations('windows.emoji.names');
  return (
    <div data-window={EMOJI_WINDOW_ID} className={cn('flex flex-col gap-3', className)}>
      {seatLabel ? <p className="text-label-sm text-text-secondary">{seatLabel}</p> : null}
      <RadioGroup
        variant="grid"
        label={t('title')}
        value={value}
        disabled={waitSec > 0}
        onValueChange={onSelect}
        options={EMOJI_PICKER_IDS.map((id) => ({ value: id, label: names(id), symbol: EMOJI_SYMBOLS[id] ?? '✨' }))}
      />
      {waitSec > 0 ? (
        <p role="status" className="text-caption text-primary">
          {t('tooOften')}
        </p>
      ) : (
        <p className="text-caption text-text-muted">{c('emotionHint')}</p>
      )}
      {onWall ? (
        <p className="flex items-center gap-2 text-caption text-text-secondary" data-row="on-wall">
          {c('emotionOnWall')}: <strong className="font-semibold text-text">{onWall.name}</strong>
          <span role="img" aria-label={names(canonicalEmotion(onWall.emojiId))}>
            {EMOJI_SYMBOLS[canonicalEmotion(onWall.emojiId)] ?? '✨'}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export interface SavedEmotion {
  emojiId: string;
  greetingChanged: boolean;
}

function hasFlag(code: string | undefined): code is string {
  return !!code && code.toUpperCase() !== 'UN';
}

export interface MyEmotionPanelProps {
  eventId: string;
  onSaved?: (saved: SavedEmotion) => void;
}

/** Вміст вікна «Моя емоція» (під шапкою «‹ Назад · Моя емоція»). */
export function MyEmotionPanel({ eventId, onSaved }: MyEmotionPanelProps) {
  const c = useTranslations('chat');
  const names = useTranslations('windows.emoji.names');
  const overlay = useOverlay();
  const now = useNow();
  const entry = useGuestStore((s) => s.firstRow[eventId]);
  const nick = useGuestStore((s) => s.nick);
  const flagCode = useGuestStore((s) => s.flagCode ?? s.detectedFlag);
  const updateFirstRow = useGuestStore((s) => s.updateFirstRow);
  const changedAt = useChatUi((s) => s.emotionChangedAt);
  const markChanged = useChatUi((s) => s.markEmotionChanged);

  const savedEmoji = canonicalEmotion(entry?.draft?.emojiId);
  const savedGreeting = entry?.draft?.greeting ?? '';
  const name = entry?.draft?.name || nick || '';
  const [emoji, setEmoji] = useState<string>(savedEmoji);
  const [greeting, setGreeting] = useState(savedGreeting);
  const wait = emotionWaitSec(changedAt, now);

  const save = () => {
    if (emotionWaitSec(changedAt, now) > 0) return;
    const text = greeting.trim().slice(0, GREETING_MAX);
    updateFirstRow(eventId, (prev) => ({ ...prev, draft: { name: prev.draft?.name ?? name, greeting: text, emojiId: emoji } }));
      markChanged(now);
    onSaved?.({ emojiId: emoji, greetingChanged: text !== savedGreeting.trim() });
    overlay.close(EMOJI_WINDOW_ID);
  };

  return (
    <form
      data-window={EMOJI_WINDOW_ID}
      aria-label={c('emotionTitle')}
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-2 pt-3">
        <div className="t2f-emo-preview" data-row="preview">
          <span className="t2f-emo-hint">
            {c('emotionPreviewHint', { seat: entry?.seat ?? '' })}
          </span>
          <span
            role="img"
            aria-label={c('emotionPreviewLabel', { name, emotion: names(canonicalEmotion(emoji)) })}
            className="t2f-emo-wall"
          >
            {hasFlag(flagCode) ? <Flag code={flagCode} size="pill" decorative className="t2f-emo-flag" /> : null}
            <span className="truncate">{name}</span>
            <span aria-hidden="true" className="t2f-emo-wall-glyph">
              {EMOJI_SYMBOLS[emoji] ?? '✨'}
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor="me-greeting" className="t2f-emo-label">
              {c('emotionGreeting')}{' '}
              <span className="font-medium text-text-muted">· {c('emotionGreetingMax', { max: GREETING_MAX })}</span>
            </label>
            <span aria-live="polite" className="t2f-emo-count">
              {greeting.length}/{GREETING_MAX}
            </span>
          </div>
          <input
            id="me-greeting"
            type="text"
            maxLength={GREETING_MAX}
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            autoComplete="off"
            className="t2f-focus t2f-emo-input"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="t2f-emo-label">
            {c('emotionPick')} <span className="font-medium text-text-muted">· {names(canonicalEmotion(emoji))}</span>
          </div>
          <Radix.Root
            aria-label={c('emotionPick')}
            value={emoji}
            onValueChange={setEmoji}
            orientation="horizontal"
            className="t2f-emo-grid"
          >
            {EMOTION_IDS.map((id) => (
              <Radix.Item
                key={id}
                value={id}
                aria-label={names(id)}
                className="t2f-focus group flex size-11 items-center justify-center justify-self-center rounded-full bg-transparent p-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    't2f-emo-glyph',
                  )}
                >
                  {EMOJI_SYMBOLS[id]}
                </span>
              </Radix.Item>
            ))}
          </Radix.Root>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-t border-border px-4 pb-4 pt-2.5">
        {wait > 0 ? (
          <p role="status" className="t2f-emo-rate" data-row="rate">
            {c('emotionRateHint')}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={wait > 0}
            className={cn(
              't2f-focus t2f-emo-btn flex-1',
              wait > 0 ? 'bg-surface-raised text-text-muted' : 'bg-primary-fill text-on-primary hover:bg-primary-fill-hover',
            )}
          >
            {wait > 0 ? c('emotionSaveWait', { seconds: wait }) : c('emotionSave')}
          </button>
          <button
            type="button"
            onClick={() => overlay.close(EMOJI_WINDOW_ID)}
            className="t2f-focus t2f-emo-btn t2f-emo-cancel"
          >
            {c('emotionCancel')}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Відкрити «Моя емоція» у вікні чату (телефон — вікно чату внизу, десктоп — колонка). */
export function useOpenMyEmotion(eventId: string, onSaved?: (saved: SavedEmotion) => void) {
  const c = useTranslations('chat');
  const overlay = useOverlay();
  return () =>
    overlay.open({
      id: EMOJI_WINDOW_ID,
      inChat: true,
      kind: 'nonmodal',
      chrome: 'author',
      title: <span className="t2f-emo-title">{c('emotionTitle')}</span>,
      content: <MyEmotionPanel eventId={eventId} onSaved={onSaved} />,
    });
}

export interface MyEmotionPillProps {
  /** Подія «Першого ряду», емоцію якої змінюємо. */
  eventId: string;
  onSaved?: (saved: SavedEmotion) => void;
  className?: string;
}

/** Таблетка «Моя емоція» (макет: 32 px видимих, 44 px дотик) — у рядку кімнати «Перший ряд». */
export function MyEmotionPill({ eventId, onSaved, className }: MyEmotionPillProps) {
  const c = useTranslations('chat');
  const names = useTranslations('windows.emoji.names');
  const entry = useGuestStore((s) => s.firstRow[eventId]);
  const open = useOpenMyEmotion(eventId, onSaved);
  const current = canonicalEmotion(entry?.draft?.emojiId);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={c('myEmotionAria', { emotion: names(current).toLowerCase() })}
      onClick={open}
      data-action="my-emotion"
      className={cn('t2f-focus flex h-11 shrink-0 items-center rounded-full bg-transparent p-0', className)}
    >
      <span className="t2f-emo-chip">
        <span aria-hidden="true" className="t2f-emo-chip-glyph">
          {EMOJI_SYMBOLS[current]}
        </span>
        {c('myEmotion')}
        <Icon name="chevron-down" size={14} strokeWidth={2.2} className="text-text-secondary" />
      </span>
    </button>
  );
}
