'use client';

/**
 * SeatPill (C7) — місце учасника на стіні «Першого ряду»: круглий прапор (як усюди на сайті), повне ім’я, емоція 20 px.
 * Стани: `idle` (тонка жовта межа), `lit` (залите жовтим — після півночі), своє — межа `text` і «Ти»
 * (дотик до свого відкриває O-EMOJI).
 * Доступна назва місця — без емодзі: «Місце 4: Олена і друзі, Україна, емоція: келихи» (ІНВ I-33, I-35).
 * Емодзі візуальне (aria-hidden); назва емоції береться з набору O-EMOJI (`windows.emoji.names.*`).
 */
import { useTranslations } from 'next-intl';
import { Emoji } from '@/components/primitives/Emoji';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import type { SeatParticipant } from '@/lib/data/types';
import { canonicalEmotion, emotionSymbol, EMOTIONS } from '@/lib/firstrow/emotions';
import './SeatPill.css';

/** Символи набору емоцій (O-EMOJI). Назви — у `windows.emoji.names.<id>`. */
export const EMOJI_SYMBOLS: Record<string, string> = Object.fromEntries(EMOTIONS.map((e) => [e.id, e.symbol]));

export function emojiSymbol(id: string | undefined): string {
  return id ? emotionSymbol(id) : '✨';
}

export type SeatPillState = 'idle' | 'lit';

export interface SeatPillProps {
  /** Номер місця 1…10. */
  seat: number;
  participant: Pick<SeatParticipant, 'name' | 'flagCode' | 'emojiId'> & { isMine?: boolean };
  /** Назва країни прапора (для доступної назви). */
  countryName?: string;
  state?: SeatPillState;
  /** Щойно загорілось: коротка поява (лише у `lively`). */
  fresh?: boolean;
  /** Тільки для свого місця: відкрити вибір емоції (O-EMOJI). */
  onOpenEmoji?: () => void;
  /** Чуже місце: відкрити картку учасника (O-AUTHOR, рішення 2026-10-31). */
  onOpen?: () => void;
  className?: string;
}

export function SeatPill({ seat, participant, countryName, state = 'idle', fresh = false, onOpenEmoji, onOpen, className }: SeatPillProps) {
  const t = useTranslations('firstRow');
  const names = useTranslations('windows.emoji.names');
  const mine = participant.isMine === true;
  const emotionId = canonicalEmotion(participant.emojiId);
  const emotion = names(emotionId as never);
  const base = countryName
    ? t('seatLabelFull', { n: seat, name: participant.name, country: countryName, emotion })
    : t('seatLabelShort', { n: seat, name: participant.name, emotion });
  const label = mine ? `${base}. ${t('yourSeat')}` : base;

  const classes = cn(
    't2f-transition inline-flex min-h-touch-min items-center gap-2 rounded-full border ps-3 text-label-sm',
    mine ? 'pe-2' : 'pe-3.5',
    state === 'lit' ? 'bg-highlight text-on-highlight' : 'bg-highlight-tint text-text',
    mine ? 'border-text' : state === 'lit' ? 'border-highlight' : 'border-highlight/40',
    className,
  );

  const body = (
    <>
      <Flag round code={participant.flagCode} size="pill" decorative className="t2f-seat-flag" />
      <span className="whitespace-nowrap">{participant.name}</span>
      <span aria-hidden="true" className="t2f-seat-emoji">
        <Emoji char={emojiSymbol(participant.emojiId)} />
      </span>
      {mine ? (
        state === 'lit' ? (
          <span className="inline-flex h-5 items-center rounded-full border border-on-highlight px-2 text-label-badge-chat">{t('you')}</span>
        ) : (
          <Badge variant="you">{t('you')}</Badge>
        )
      ) : null}
    </>
  );

  const common = { 'data-seat': seat, 'data-state': state, 'data-fresh': fresh ? 'true' : undefined, 'data-mine': mine ? 'true' : undefined };

  if (mine) {
    return (
      <button type="button" aria-label={label} onClick={onOpenEmoji} className={cn('t2f-focus', classes)} {...common}>
        {body}
      </button>
    );
  }
  if (onOpen) {
    return (
      <button type="button" data-opens-author="" aria-label={t('seatOpen', { label })} onClick={onOpen} className={cn('t2f-focus hover:border-highlight', classes)} {...common}>
        {body}
      </button>
    );
  }
  return (
    <div role="img" aria-label={label} className={classes} {...common}>
      {body}
    </div>
  );
}
