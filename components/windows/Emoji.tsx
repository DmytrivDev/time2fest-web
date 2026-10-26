'use client';

/**
 * C25 O-EMOJI — «Моя емоція» учасника «Першого ряду» (FR-054).
 * `EmojiPicker` — вміст вікна: RadioGroup `grid` із 16 емодзі (назви з набору `windows.emoji.names`), застосовується одразу,
 * змінювати можна раз на 10 с (тоді — «Змінювати емоцію можна раз на 10 с»).
 * `MyEmotionButton` — кнопка в шапці кімнати: десктоп — Popover біля кнопки, телефон — Sheet через OverlayManager.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EMOJI_SYMBOLS } from '@/components/live/SeatPill';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { RadioGroup } from '@/components/primitives/RadioGroup';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { emotionWaitSec, useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { useNow } from '@/lib/time/TimeProvider';

/** 16 емодзі набору O-EMOJI у порядку на аркуші. */
export const EMOJI_PICKER_IDS = [
  'glasses',
  'confetti',
  'fireworks',
  'sparkles',
  'heart',
  'hat',
  'star',
  'fire',
  'tree',
  'gift',
  'clock',
  'hug',
  'smile',
  'tears',
  'dance',
  'peace',
] as const;

export const EMOJI_WINDOW_ID = 'O-EMOJI';

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
          <span role="img" aria-label={names(onWall.emojiId as never)}>
            {EMOJI_SYMBOLS[onWall.emojiId] ?? '✨'}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export interface MyEmotionButtonProps {
  /** Подія «Першого ряду», емоцію якої змінюємо. */
  eventId: string;
  seatLabel?: string;
  className?: string;
}

/** Кнопка «Моя емоція» з емодзі поточної емоції; сама відкриває вибір. */
export function MyEmotionButton({ eventId, seatLabel, className }: MyEmotionButtonProps) {
  const c = useTranslations('chat');
  const names = useTranslations('windows.emoji.names');
  const column = useChatColumn();
  const overlay = useOverlay();
  const now = useNow();
  const entry = useGuestStore((s) => s.firstRow[eventId]);
  const updateFirstRow = useGuestStore((s) => s.updateFirstRow);
  const changedAt = useChatUi((s) => s.emotionChangedAt);
  const markChanged = useChatUi((s) => s.markEmotionChanged);
  const [open, setOpen] = useState(false);
  const current = entry?.draft?.emojiId ?? 'glasses';
  const wait = emotionWaitSec(changedAt, now);

  const pick = (emojiId: string) => {
    if (emotionWaitSec(changedAt, now) > 0) return;
    updateFirstRow(eventId, (prev) => ({ ...prev, draft: { name: prev.draft?.name ?? '', greeting: prev.draft?.greeting ?? '', emojiId } }));
    markChanged(now);
    setOpen(false);
    overlay.close(EMOJI_WINDOW_ID);
  };

  const label = (
    <>
      <span role="img" aria-label={names(current as never)} className="text-body leading-none">
        {EMOJI_SYMBOLS[current] ?? '✨'}
      </span>
      {c('myEmotion')}
    </>
  );

  if (column) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="tonal" compact className={className}>
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <EmojiPicker value={current} onSelect={pick} waitSec={wait} seatLabel={seatLabel} />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Button
      type="button"
      variant="tonal"
      compact
      className={className}
      onClick={() =>
        overlay.open({
          id: EMOJI_WINDOW_ID,
          kind: 'nonmodal',
          title: c('emotionTitle'),
          content: <EmojiPicker value={current} onSelect={pick} waitSec={wait} seatLabel={seatLabel} />,
        })
      }
    >
      {label}
    </Button>
  );
}
