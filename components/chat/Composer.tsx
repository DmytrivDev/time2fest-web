'use client';

/**
 * C11. Composer — поле введення чату (FR-050…052).
 * Частини: цитата відповіді («Скасувати відповідь») · Textarea (приховану мітку «Повідомлення в чат «Світ»» задає `inputLabel`) ·
 * кнопка-емодзі (вибір емодзі над рядком поля, `EmojiPicker`: вставка в позицію курсора, ліміт 200 діє) · «Надіслати» · підказка · лічильник.
 * Перед емодзі — келих «Сказати тост» (`onToast`; дошки `Desk-Toast-New`, `Phone-Toast-New`, рішення 2026-11-12): завжди в полі.
 * Стани: гість (перше «Надіслати» відкриває O-NICK — це справа батька через `onSubmit`), лічильник від 180 з 200
 * (за 5 до межі — `text`, на 200 — кораловий «Досить», оголошення на 180/195/200), `link-error`
 * («Посилання в чаті не надсилаються — прибери його, текст лишиться»), `slow` (кнопка неактивна з причиною:
 * «Надіслати — зачекай 8 секунд»), `banned`, `offline`. Текст після помилки не стирається.
 * Поле керується батьком (`value`), щоб текст переживав вікно ніка.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Textarea } from '@/components/primitives/Textarea';
import type { RoomId } from '@/lib/data/types';
import { ANNOUNCE_AT, COUNTER_FROM, MAX_TEXT } from '@/lib/chat-sim/send';
import { EmojiPicker } from './EmojiPicker';
import ts from './composerToast.module.css';

export type ComposerError = 'link' | 'too-long' | null;

export interface ComposerProps {
  room: { id: RoomId; label: string };
  value: string;
  onValueChange: (value: string) => void;
  /** Надіслати поточний `value`. */
  onSubmit: () => void;
  error?: ComposerError;
  /** Скільки секунд лишилось до наступного відправлення (0 — можна). */
  slowRemaining?: number;
  /** Повільний режим у кімнаті зараз (c); для підказки «раз на 15 с». */
  slowTotal?: number;
  banned?: boolean;
  offline?: boolean;
  /** Цитата відповіді. */
  reply?: { nick: string; excerpt: string } | null;
  onCancelReply?: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Келих «Сказати тост» у полі, поруч з емодзі — завжди (рішення власника 2026-11-12); відкриває вікно тосту. */
  onToast?: () => void;
  className?: string;
}

export function Composer({
  room,
  value,
  onValueChange,
  onSubmit,
  error = null,
  slowRemaining = 0,
  slowTotal = 0,
  banned = false,
  offline = false,
  reply = null,
  onCancelReply,
  textareaRef,
  onToast,
  className,
}: ComposerProps) {
  const t = useTranslations('chat');
  const announce = useAnnounce();
  // Вибір емодзі: `kb` — відкрито з клавіатури (фокус на першу клітинку).
  const [picker, setPicker] = useState<{ kb: boolean } | null>(null);
  const uid = useId();
  const inputId = `${uid}-input`;
  const emojiBtnId = `${uid}-emoji`;
  const pickerId = `${uid}-picker`;
  const inactive = banned || offline;
  const slow = slowRemaining > 0;

  // Оголошення лічильника на 180, 195, 200 (один раз на перетин).
  const prevLen = useRef(value.length);
  useEffect(() => {
    const prev = prevLen.current;
    const len = value.length;
    prevLen.current = len;
    for (const mark of ANNOUNCE_AT) {
      if (prev < mark && len >= mark) announce(mark === MAX_TEXT ? t('limitAnnounce') : t('counterAnnounce', { count: mark, max: MAX_TEXT }));
    }
  }, [value, announce, t]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!inactive && !slow) onSubmit();
    }
  };

  const hints: string[] = [];
  if (value.length >= MAX_TEXT) hints.push(t('limitReached'));
  if (banned) hints.push(t('bannedInput'));
  if (offline) hints.push(t('offlineInput'));
  // Макет `Phone-Chat-Slow`: годинник, секунди жирним світлим.
  const slowHint =
    slow || slowTotal > 0 ? (
      <span data-row="slow-hint" className="inline-flex items-center gap-1.5 text-text-secondary">
        <Icon name="clock" size={14} strokeWidth={2} className="shrink-0" />
        <span>
          {t.rich(slow ? 'slowNote' : 'slowActive', {
            seconds: slow ? slowRemaining : slowTotal,
            b: (chunks) => <b className="font-bold text-text tabular-nums">{chunks}</b>,
          })}
        </span>
      </span>
    ) : null;

  const errorText = error === 'link' ? t('linkError') : error === 'too-long' ? t('tooLong') : undefined;
  const sendLabel = slow ? t('sendWait', { seconds: slowRemaining }) : t('send');

  const closePicker = useCallback(
    (opts?: { restoreFocus?: boolean }) => {
      setPicker(null);
      if (opts?.restoreFocus) requestAnimationFrame(() => document.getElementById(emojiBtnId)?.focus());
    },
    [emojiBtnId],
  );

  /** Вставка в позицію курсора (виділення замінюється); ліміт 200 символів діє; курсор — після емодзі. */
  const insertEmoji = (symbol: string) => {
    const el = document.getElementById(inputId) as HTMLTextAreaElement | null;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = value.slice(0, start) + symbol + value.slice(end);
    if (next.length > MAX_TEXT) {
      announce(t('limitAnnounce'));
      return;
    }
    onValueChange(next);
    const caret = start + symbol.length;
    requestAnimationFrame(() => {
      const field = document.getElementById(inputId) as HTMLTextAreaElement | null;
      field?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div data-composer="" className={cn('flex shrink-0 flex-col gap-2 border-t border-border px-3 pb-3 pt-2.5', className)}>
      {reply ? (
        <div className="t2f-reply-bar" data-row="reply-draft">
          <Icon name="reply" size={16} strokeWidth={2} className="shrink-0 text-highlight" />
          <div className="t2f-reply-bar-text">
            <p className="t2f-reply-bar-nick">{t('replyTo', { nick: reply.nick })}</p>
            <p className="t2f-reply-bar-excerpt">{reply.excerpt}</p>
          </div>
          <button type="button" className="t2f-focus t2f-reply-bar-x" aria-label={t('cancelReply')} onClick={onCancelReply}>
            <Icon name="close" size={18} strokeWidth={2} />
          </button>
        </div>
      ) : null}
      {/* Рядок поля: відносна основа для вибору емодзі (над рядком, від поля до «Надіслати»). Esc закриває вибір. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="relative flex items-start gap-2"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && picker) {
            e.preventDefault();
            closePicker({ restoreFocus: true });
          }
        }}
      >
      {picker ? <EmojiPicker id={pickerId} onInsert={insertEmoji} onClose={closePicker} focusFirst={picker.kb} /> : null}
      <Textarea
        id={inputId}
        ref={textareaRef}
        className="min-w-0 flex-1"
        frameClassName="t2f-chat-input"
        label={t('inputLabel', { room: room.label })}
        hideLabel
        maxRows={3}
        placeholder={room.id.startsWith('country:') ? t('inputPlaceholderCountry') : t('inputLabel', { room: room.label })}
        value={value}
        maxLength={MAX_TEXT}
        counter
        counterFrom={COUNTER_FROM}
        disabled={banned}
        error={errorText}
        hint={
          slowHint || hints.length ? (
            <>
              {slowHint}
              {slowHint && hints.length ? ' · ' : null}
              {hints.length ? hints.join(' · ') : null}
            </>
          ) : undefined
        }
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        endSlot={
          <>
            {onToast ? (
              <span className={ts.wrap}>
                <button type="button" aria-label={t('toastButton')} onClick={onToast} className={cn('t2f-focus', ts.btn)} data-action="chat-toast">
                  <Icon name="glass" size={16} />
                </button>
                <span aria-hidden="true" className={ts.tip}>
                  {t('toastButton')}
                </span>
              </span>
            ) : null}
            <IconButton
              id={emojiBtnId}
              icon="smile"
              compact
              aria-label={t('emojiButton')}
              aria-haspopup="dialog"
              aria-expanded={picker !== null}
              aria-controls={picker ? pickerId : undefined}
              data-emoji-trigger=""
              disabled={inactive}
              onClick={(e) => {
                if (picker) {
                  closePicker();
                  return;
                }
                const kb = e.detail === 0;
                setPicker({ kb });
                // Мишею: фокус лишається в полі, щоб вставка йшла в позицію курсора.
                if (!kb) requestAnimationFrame(() => document.getElementById(inputId)?.focus());
              }}
            />
          </>
        }
      />
      {/* Макет: «Надіслати» — окреме коло 44 px на border-фоні праворуч від поля. */}
      <button
        type="button"
        aria-label={sendLabel}
        aria-disabled={inactive || slow || undefined}
        title={slow ? sendLabel : undefined}
        onClick={() => {
          if (!inactive && !slow) onSubmit();
        }}
        className="t2f-focus t2f-press t2f-transition inline-flex size-touch-min shrink-0 items-center justify-center rounded-full bg-border text-text hover:bg-border-strong aria-disabled:text-text-muted"
      >
        <Icon name="send" size={18} />
      </button>
      </div>
    </div>
  );
}
