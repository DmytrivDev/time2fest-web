'use client';

/**
 * Поле тосту й усе навколо нього: «дзеркало» з підкресленим місцем фільтра (`Mirror`), підпис «нік + прапор» (`Who`),
 * саме поле (`ToastField`), ідеї-чипси (`Phrases`) і підпис тосту (`Signature`: свій нік або «Як підписати тост?» для гостя).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useId, useMemo, useState } from 'react';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { cn } from '@/components/primitives/cn';
import { EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { FlagField } from '@/components/windows/FlagField';
import { type NickIssue } from '@/lib/chat/nick';
import { NICK_MAX } from '@/lib/chat/send';
import { getData } from '@/lib/data/load';
import { TOAST_MAX } from '@/lib/toast/tiers';
import { useToastStore } from '@/stores/toast';
import { useProfile } from '@/lib/api/hooks/auth';
import { ToastPill } from './ToastBubble';
import s from './toastWindow.module.css';


const PHRASES = ['one', 'two', 'three', 'four'] as const;

const flagOptions = () => getData().countries.map((c) => ({ code: c.flagCode, name: c.name.uk }));

/** Текст із підкресленим проблемним місцем — «дзеркало» під полем (той самий кегль і перенос). */
function Mirror({ text, start, end }: { text: string; start: number; end: number }) {
  return (
    <div aria-hidden="true" className={s.mirror}>
      {text.slice(0, start)}
      <span className={s.bad} data-toast-bad="">
        {text.slice(start, end)}
      </span>
      {text.slice(end)}
      {'​'}
    </div>
  );
}

export function Who({ nick, flagCode }: { nick?: string; flagCode?: string }) {
  const t = useTranslations('toast');
  return nick ? (
    <>
      {flagCode ? <Flag code={flagCode} size="xs" decorative /> : null}
      <b className={s.fieldNick}>{nick}</b>
    </>
  ) : (
    <>
      <span className={s.noFlag} aria-hidden="true" />
      <b className={s.fieldNick} data-empty="">
        {t('yourNick')}
      </b>
    </>
  );
}

/** Поле тосту: нік і прапор, «тост», лічильник, емодзі (вибір — у потоці під полем), текст до 120. */
export function ToastField({ nick, flagCode }: { nick?: string; flagCode?: string }) {
  const t = useTranslations('toast');
  const tc = useTranslations('chat');
  const text = useToastStore((x) => x.text);
  const issue = useToastStore((x) => x.issue);
  const setText = useToastStore((x) => x.setText);
  const id = useId();
  const pickerId = useId();
  const emojiBtnId = useId();
  const [picker, setPicker] = useState<{ kb: boolean } | null>(null);
  const closePicker = useCallback(
    (opts?: { restoreFocus?: boolean }) => {
      setPicker(null);
      if (opts?.restoreFocus) requestAnimationFrame(() => document.getElementById(emojiBtnId)?.focus());
    },
    [emojiBtnId],
  );
  const insertEmoji = (symbol: string) => {
    const el = document.getElementById(id) as HTMLTextAreaElement | null;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = text.slice(0, start) + symbol + text.slice(end);
    if (next.length > TOAST_MAX) return;
    setText(next);
    const caret = start + symbol.length;
    requestAnimationFrame(() => (document.getElementById(id) as HTMLTextAreaElement | null)?.setSelectionRange(caret, caret));
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Esc закриває вибір емодзі
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape' && picker) {
          e.preventDefault();
          e.stopPropagation();
          closePicker({ restoreFocus: true });
        }
      }}
      className="flex flex-col gap-2"
    >
      <div className={s.field} data-error={issue ? '' : undefined} data-toast-field="">
        <div className={s.fieldHead}>
          <Who nick={nick} flagCode={flagCode} />
          <ToastPill />
          <span className="flex-1" />
          <span className={s.counter} aria-hidden="true">
            {text.length} / {TOAST_MAX}
          </span>
          <IconButton
            id={emojiBtnId}
            icon="smile"
            compact
            aria-label={tc('emojiButton')}
            aria-haspopup="dialog"
            aria-expanded={picker !== null}
            aria-controls={picker ? pickerId : undefined}
            data-emoji-trigger=""
            onClick={(e) => setPicker((p) => (p ? null : { kb: e.detail === 0 }))}
            className={s.emojiBtn}
          />
        </div>
        <div className={s.area}>
          {issue ? <Mirror text={text} start={issue.start} end={issue.end} /> : null}
          <label htmlFor={id} className="sr-only">
            {t('field')}
          </label>
          <textarea
            id={id}
            value={text}
            maxLength={TOAST_MAX}
            rows={1}
            placeholder={t('placeholder')}
            aria-invalid={issue ? true : undefined}
            onChange={(e) => setText(e.target.value)}
            className={cn('t2f-focus', s.textarea)}
            data-toast-text=""
          />
        </div>
      </div>
      {picker ? (
        <div className={s.picker}>
          <EmojiPicker id={pickerId} onInsert={insertEmoji} onClose={closePicker} focusFirst={picker.kb} />
        </div>
      ) : null}
    </div>
  );
}

export function Phrases() {
  const t = useTranslations('toast');
  const text = useToastStore((x) => x.text);
  const setText = useToastStore((x) => x.setText);
  return (
    <div className={s.chips} role="group" aria-label={t('ideas')}>
      {PHRASES.map((k) => {
        const p = t(`phrases.${k}`);
        return (
          <button key={k} type="button" aria-pressed={text === p} aria-label={p} onClick={() => setText(p)} className={cn('t2f-focus', s.chip)}>
            <EmojiText text={p} />
          </button>
        );
      })}
    </div>
  );
}

/** Підпис: нік і прапор (дійсний нік), або «Як підписати тост?» — гість, «Змінити». */
export function Signature({
  editing,
  draftNick,
  draftFlag,
  onEdit,
  onNick,
  onFlag,
  issue,
}: {
  editing: boolean;
  draftNick: string;
  draftFlag: string;
  onEdit: () => void;
  onNick: (v: string) => void;
  onFlag: (v: string) => void;
  issue: NickIssue | null;
}) {
  const t = useTranslations('toast');
  const tc = useTranslations('chat.nick');
  const w = useTranslations('windows.nick');
  const detected = useProfile()?.detectedFlag ?? undefined;
  const [flagOpen, setFlagOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const flags = useMemo(() => flagOptions(), []);
  const id = useId();
  if (!editing) {
    return (
      <div className={s.sig} data-toast-signature="">
        <Flag code={draftFlag} diameter={28} decorative />
        <span className={s.sigText}>
          <span className={s.sigLabel}>{t('signature')}</span>
          <b className={s.sigNick}>{draftNick}</b>
        </span>
        <button type="button" onClick={onEdit} className={cn('t2f-focus', s.textLink)}>
          {t('change')}
        </button>
      </div>
    );
  }
  const shown = touched && draftNick.length > 0 ? issue : null;
  const err = shown
    ? shown === 'taken'
      ? w('taken')
      : shown === 'forbidden'
        ? w('forbidden')
        : shown === 'link'
          ? tc('errors.link')
          : shown === 'long'
            ? tc('errors.long')
            : tc('errors.short')
    : null;
  return (
    <section className={s.guest} aria-labelledby={`${id}-t`} data-toast-guest="">
      <h4 id={`${id}-t`} className={s.guestTitle}>
        {t('guest.title')}
      </h4>
      <p className={s.guestSub}>{t('guest.sub')}</p>
      <div className={s.guestRow}>
        <button
          type="button"
          aria-label={t('guest.flag')}
          aria-expanded={flagOpen}
          onClick={() => setFlagOpen((v) => !v)}
          className={cn('t2f-focus', s.flagBtn)}
        >
          <Flag code={draftFlag} diameter={24} decorative />
          <Icon name="chevron-down" size={14} />
        </button>
        <span className={s.nickBox} data-error={err ? '' : undefined}>
          <label htmlFor={`${id}-n`} className="sr-only">
            {t('guest.nick')}
          </label>
          <input
            id={`${id}-n`}
            type="text"
            value={draftNick}
            autoComplete="nickname"
            maxLength={NICK_MAX + 5}
            aria-invalid={err ? true : undefined}
            aria-describedby={`${id}-h`}
            onChange={(e) => onNick(e.target.value)}
            onBlur={() => setTouched(true)}
            className={s.nickInput}
            data-toast-nick=""
          />
          <span className={s.counter} aria-hidden="true">
            {draftNick.length} / {NICK_MAX}
          </span>
        </span>
      </div>
      {flagOpen ? (
        <div className={s.flagPick}>
          <FlagField
            value={draftFlag}
            onChange={(code) => {
              onFlag(code);
              setFlagOpen(false);
            }}
            detectedFlag={detected}
            undetected={!detected}
            openIfUnknown
            flags={flags}
          />
        </div>
      ) : null}
      {err ? (
        <p className={s.guestErr} role="alert">
          {err}
        </p>
      ) : null}
      <p id={`${id}-h`} className={s.guestHint}>
        {detected ? t('guest.hint') : t('guest.hintUndetected')}
      </p>
    </section>
  );
}
