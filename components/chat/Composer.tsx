'use client';

/**
 * C11. Composer — поле введення чату (FR-050…052).
 * Частини: цитата відповіді («Скасувати відповідь») · Textarea (приховану мітку «Повідомлення в чат «Світ»» задає `inputLabel`) ·
 * «Готові привітання» (Popover, привітання одним дотиком мовою автора, з прапором) · «Надіслати» · підказка · лічильник.
 * Стани: гість (перше «Надіслати» відкриває O-NICK — це справа батька через `onSubmit`), лічильник від 180 з 200
 * (за 5 до межі — `text`, на 200 — кораловий «Досить», оголошення на 180/195/200), `link-error`
 * («Посилання в чаті не надсилаються — прибери його, текст лишиться»), `slow` (кнопка неактивна з причиною:
 * «Надіслати — зачекай 8 секунд»), `banned`, `offline`. Текст після помилки не стирається.
 * Поле керується батьком (`value`), щоб текст переживав вікно ніка.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { IconButton } from '@/components/primitives/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { Textarea } from '@/components/primitives/Textarea';
import type { RoomId } from '@/lib/data/types';
import { ANNOUNCE_AT, COUNTER_FROM, MAX_TEXT } from '@/lib/chat-sim/send';

export interface ComposerPreset {
  lang: string;
  flagCode: string;
  text: string;
}

export type ComposerError = 'link' | 'too-long' | null;

export interface ComposerProps {
  room: { id: RoomId; label: string };
  value: string;
  onValueChange: (value: string) => void;
  /** Надіслати поточний `value`. */
  onSubmit: () => void;
  /** Привітання одним дотиком: надсилається одразу. */
  onPreset?: (text: string) => void;
  presets?: readonly ComposerPreset[];
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
  className?: string;
}

export function Composer({
  room,
  value,
  onValueChange,
  onSubmit,
  onPreset,
  presets = [],
  error = null,
  slowRemaining = 0,
  slowTotal = 0,
  banned = false,
  offline = false,
  reply = null,
  onCancelReply,
  textareaRef,
  className,
}: ComposerProps) {
  const t = useTranslations('chat');
  const announce = useAnnounce();
  const [presetsOpen, setPresetsOpen] = useState(false);
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
  if (slow) hints.push(t('slowNote', { seconds: slowRemaining }));
  else if (slowTotal > 0) hints.push(t('slowActive', { seconds: slowTotal }));
  if (banned) hints.push(t('bannedInput'));
  if (offline) hints.push(t('offlineInput'));

  const errorText = error === 'link' ? t('linkError') : error === 'too-long' ? t('tooLong') : undefined;
  const sendLabel = slow ? t('sendWait', { seconds: slowRemaining }) : t('send');
  const ordered = [...presets].sort((a, b) => Number(b.lang === 'uk') - Number(a.lang === 'uk'));

  return (
    <div data-composer="" className={cn('flex shrink-0 flex-col gap-2 border-t border-border bg-background px-3 pb-3 pt-2', className)}>
      {reply ? (
        <div className="flex items-center gap-2 rounded-md bg-surface px-3" data-row="reply-draft">
          <p className="min-w-0 flex-1 truncate py-2 text-caption text-text-secondary">
            <span className="font-semibold text-text">{t('replyTo', { nick: reply.nick })}</span> {reply.excerpt}
          </p>
          <IconButton icon="close" compact iconSize={16} aria-label={t('cancelReply')} onClick={onCancelReply} />
        </div>
      ) : null}
      <Textarea
        ref={textareaRef}
        label={t('inputLabel', { room: room.label })}
        hideLabel
        placeholder={t('inputPlaceholder')}
        value={value}
        maxLength={MAX_TEXT}
        counter
        counterFrom={COUNTER_FROM}
        disabled={banned}
        error={errorText}
        hint={hints.length ? hints.join(' · ') : undefined}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={onKeyDown}
        endSlot={
          <>
            <Popover open={presetsOpen} onOpenChange={setPresetsOpen}>
              <PopoverTrigger asChild>
                <IconButton icon="smile" aria-label={t('greetings')} disabled={inactive} />
              </PopoverTrigger>
              <PopoverContent align="end" side="top" className="w-72 p-1">
                <p className="px-3 pb-1 pt-2 text-caption text-text-muted">{t('greetingsHint')}</p>
                <ul className="flex flex-col" aria-label={t('greetings')}>
                  {ordered.map((p) => (
                    <li key={`${p.lang}:${p.text}`}>
                      <button
                        type="button"
                        lang={p.lang}
                        onClick={() => {
                          setPresetsOpen(false);
                          onPreset?.(p.text);
                        }}
                        className="t2f-focus t2f-transition flex min-h-touch-min w-full items-center gap-3 rounded-md px-3 text-start text-body text-text hover:bg-border"
                      >
                        <Flag code={p.flagCode} size="xs" decorative />
                        <span className="flex-1">{p.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
            <IconButton
              icon="send"
              aria-label={sendLabel}
              aria-disabled={inactive || slow || undefined}
              title={slow ? sendLabel : undefined}
              onClick={() => {
                if (!inactive && !slow) onSubmit();
              }}
            />
          </>
        }
      />
    </div>
  );
}
