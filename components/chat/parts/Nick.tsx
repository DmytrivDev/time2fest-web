'use client';

/**
 * C25 O-NICK — «Як тебе підписати в чаті?» (FR-051; макети `Desk-Nick`, `Phone-Nick`, `Desk-Chat-Hidden-Input`).
 * Вікно типу `form`: десктоп — `ChatSlotPanel` на місці колонки чату, телефон — `Sheet` під плеєром (шапку з заголовком
 * і підзаголовком дає `OverlayManager`, `chrome: 'board'`). Зверху вниз:
 * - нік: рядок «Нік» + лічильник N/20, однорядкове `<input>`, помилка лише коли нік недійсний («Мінімум 2 символи»,
 *   «Максимум 20 символів», «Без посилань»; зайнятий/заборонений — як було), під нею підказка;
 * - прапор: поле з прапором і «Змінити» (як на макеті); «Змінити» ЗАМІНЮЄ його на пошук (combobox) і відкриває список
 *   (listbox): «За твоїм розташуванням», «Особливі прапори», «Усі країни». ↑/↓ — по списку, Enter — обрати, Esc — закрити
 *   й повернутись до «Змінити». Круглі прапори. Десктоп: список лежить поверх нижньої частини, висота панелі не
 *   змінюється, зменшується лише список; телефон: список у потоці й зсуває все нижче;
 * - «У чаті:» + чип (круглий прапор і нік; чип переходить на новий рядок, але нік не переноситься й не обрізається);
 * - coral «Готово» (єдина коралова кнопка), «Увійти» (вікно входу O-AUTH), «Оформити пас» (імітована оплата), «Акаунт — з 13 років (16 у ЄС) ·
 *   Умови й правила чату» (посилання на `/rules/`).
 * Текст повідомлення, заради якого відкрито вікно, лишається в полі чату — вікно про нього не знає.
 * Запис ніка на сервер (рішення власника 2026-11-14, стан шва №10): `onDone` повертає обіцянку — поки зберігаємо, кнопка
 * «Зберігаємо…»; не вдалося — вікно лишається відкритим з помилкою під кнопкою, «Готово» стає «Спробувати ще», а
 * повідомлення зі старим підписом не надсилається.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { FlagField, useFlagName, type FlagOption } from '@/components/chat/FlagField';
import { validateNick, type NickIssue } from '@/lib/chat/nick';
import { NICK_MAX } from '@/lib/chat/send';

export type { FlagOption } from '@/components/chat/FlagField';
export { SPECIAL_ALL } from '@/components/chat/FlagField';

export interface NickResult {
  nick: string;
  flagCode: string;
}

export interface NickProps {
  initialNick?: string;
  /** Прапор, який людина вже обрала раніше. */
  initialFlag?: string;
  /** Прапор за розташуванням; немає — «Прапор не визначено» і Земля. */
  detectedFlag?: string;
  /** Усі прапори для пошуку (країни). Особливі додаються самі. */
  flags: readonly FlagOption[];
  /** Ніки, які вже зайняті. */
  takenNicks?: readonly string[];
  /** Примусовий стан помилки (історії, сервер): `taken` / `forbidden`. */
  forcedIssue?: Extract<NickIssue, 'taken' | 'forbidden'>;
  /** `false` (з обіцянки) — нік не збережено: вікно лишається з помилкою й «Спробувати ще». */
  onDone: (result: NickResult) => void | Promise<boolean>;
  /** «Увійти» — вікно входу (O-AUTH) на місці цього. */
  onSignIn?: () => void;
  /** «Оформити пас» — оформлення (вікно під трансляцією чи сторінка пасу). */
  onGetPass?: () => void;
  className?: string;
}

export function Nick({
  initialNick = '',
  initialFlag,
  detectedFlag,
  flags,
  takenNicks = [],
  forcedIssue,
  onDone,
  onSignIn,
  onGetPass,
  className,
}: NickProps) {
  const t = useTranslations('windows.nick');
  const c = useTranslations('chat.nick');
  const [nick, setNick] = useState(initialNick);
  const [touched, setTouched] = useState(false);
  const initial = initialFlag ?? detectedFlag ?? 'earth';
  const [flag, setFlag] = useState(initial);
  const undetected = !initialFlag && !detectedFlag;

  const uid = useId();
  const nickId = `${uid}-nick`;
  const hintId = `${uid}-hint`;
  const countId = `${uid}-count`;
  const errId = `${uid}-err`;
  const nickRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Вікно відкрито дією людини (перше повідомлення): фокус одразу в полі ніка.
  useEffect(() => nickRef.current?.focus(), []);

  const trimmed = nick.trim();
  const issue: NickIssue | null = validateNick(nick, takenNicks) ?? forcedIssue ?? null;
  // Помилку вперше показуємо лише після виходу з поля (blur) або «Готово»; далі перевіряємо наживо на кожну зміну.
  // Примусовий стан (сервер, історії) видно одразу.
  const shown: NickIssue | null = touched || forcedIssue ? issue : null;
  const errorText = shown
    ? shown === 'taken'
      ? t('taken')
      : shown === 'forbidden'
        ? t('forbidden')
        : shown === 'link'
          ? c('errors.link')
          : shown === 'long'
            ? c('errors.long')
            : c('errors.short')
    : undefined;

  const nameOf = useFlagName(flags);
  const [save, setSave] = useState<'idle' | 'saving' | 'failed'>('idle');

  const submit = () => {
    setTouched(true);
    if (issue) {
      nickRef.current?.focus();
      return;
    }
    if (save === 'saving') return;
    const done = onDone({ nick: trimmed, flagCode: flag });
    if (!done) return;
    setSave('saving');
    void done.then((ok) => setSave(ok ? 'idle' : 'failed'));
  };

  const describedBy = [errorText ? errId : null, hintId, countId].filter(Boolean).join(' ');
  const overLimit = nick.length > NICK_MAX;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-window="O-NICK"
      className={cn('flex min-h-full flex-col gap-4 px-4 pb-4 pt-3', className)}
    >
      {/* Верх — нік і прапор, низ (прев’ю, кнопки, футер) притиснуто до низу вікна: вільне місце між ними. */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor={nickId} className="text-label-sm">
              {t('field')}
            </label>
            <span
              id={countId}
              className={cn(
                'text-label-badge-chat tabular-nums',
                overLimit ? 'text-primary' : 'text-text-muted',
              )}
              data-row="nick-count"
            >
              {nick.length}/{NICK_MAX}
            </span>
          </div>
          <input
            ref={nickRef}
            id={nickId}
            type="text"
            value={nick}
            autoComplete="nickname"
            aria-invalid={errorText ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() => setTouched(true)}
            className="t2f-nk-input"
          />
          {/* Помилка — лише коли нік недійсний; ввічливе оголошення, підказка нижче зсувається. */}
          <div aria-live="polite" id={errId} data-row="nick-error">
            {errorText ? (
              <p className="flex items-center gap-1 text-caption text-primary">
                <Icon name="alert" size={16} />
                {errorText}
              </p>
            ) : null}
          </div>
          <p id={hintId} className="t2f-nk-hint">
            {t('hint')}
          </p>
        </div>

        <FlagField
          value={flag}
          onChange={setFlag}
          detectedFlag={detectedFlag}
          undetected={undetected}
          openIfUnknown
          flags={flags}
          measureKey={errorText}
        />
      </div>

      <div className="mt-auto flex flex-col gap-4" data-row="bottom">
        <div className="t2f-nk-preview" data-row="preview">
          <span className="text-caption text-text-muted">{t('previewLabel')}</span>
          <span
            role="img"
            aria-label={`${trimmed || c('previewEmpty')}, ${nameOf(flag)}`}
            className="t2f-nk-chip"
            data-row="preview-chip"
          >
            <Flag code={flag} size="xs" decorative />
            <span aria-hidden="true">{trimmed || c('previewEmpty')}</span>
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Button type="submit" variant="coral" size="lg" className="w-full" loading={save === 'saving'} data-action="nick-done">
            {save === 'saving' ? t('saving') : save === 'failed' ? t('retry') : t('done')}
          </Button>
          {save === 'failed' ? (
            <p role="alert" className="flex items-center gap-1 text-caption text-primary" data-row="nick-save-failed">
              <Icon name="alert" size={16} />
              {t('saveFailed')}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" className="min-h-touch-min flex-1" onClick={onSignIn}>
              {t('signIn')}
            </Button>
            <Button
              type="button"
              className="min-h-touch-min flex-1"
              onClick={onGetPass}
            >
              {t('whatPassGives')}
            </Button>
          </div>
          <p className="text-center text-caption text-text-muted">
            {t('age')} ·{' '}
            <a
              href="/rules/"
              target="_blank"
              rel="noopener"
              className="t2f-focus -my-3 inline-flex min-h-touch-min items-center rounded-sm text-text-secondary underline underline-offset-2"
            >
              {c('termsLink')}
            </a>
          </p>
        </div>
      </div>
    </form>
  );
}
