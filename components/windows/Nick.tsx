'use client';

/**
 * C25 O-NICK — нік і прапор (FR-051, EXPERIENCE «Вікна»). Вікно типу `form` з полем введення: десктоп —
 * `ChatSlotPanel` на місці колонки чату, телефон — `Sheet` під плеєром (розміщення дає `OverlayManager`).
 * Частини: нік 2–20 символів з лічильником · прапор за розташуванням + пошук прапора (особливі: «Без країни», ЄС, ООН,
 * прайд-прапори) · прев’ю «Так тебе бачитимуть у чаті» · coral «Готово» (єдина коралова кнопка екрана) ·
 * «Увійти», «Що дає пас» · «Акаунт — з 13 років (16 у ЄС) · Умови й правила чату».
 * Стани: «нік зайнятий», «заборонений», «Прапор не визначено — обери свій» (Земля, «Без країни»).
 * Текст повідомлення, заради якого відкрито вікно, лишається в полі чату — вікно про нього не знає.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { RadioGroup } from '@/components/primitives/RadioGroup';
import { TextField } from '@/components/primitives/TextField';
import { validateNick, type NickIssue } from '@/lib/chat-sim/nick';
import { NICK_MAX } from '@/lib/chat-sim/send';

export interface FlagOption {
  code: string;
  name: string;
}

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
  onDone: (result: NickResult) => void;
  className?: string;
}

export const SPECIAL_ALL = ['earth', 'EU', 'un', 'pride', 'trans', 'bisexual'] as const;

/** Назва прапора: країна з набору або особливий. */
function flagName(code: string, flags: readonly FlagOption[], special: (c: string) => string): string {
  return (SPECIAL_ALL as readonly string[]).includes(code) ? special(code) : (flags.find((f) => f.code === code)?.name ?? code);
}

export function Nick({ initialNick = '', initialFlag, detectedFlag, flags, takenNicks = [], forcedIssue, onDone, className }: NickProps) {
  const t = useTranslations('windows.nick');
  const c = useTranslations('chat.nick');
  const [nick, setNick] = useState(initialNick);
  const [touched, setTouched] = useState(false);
  const initial = initialFlag ?? detectedFlag ?? 'earth';
  const [flag, setFlag] = useState(initial);
  const [choosing, setChoosing] = useState(!initialFlag && !detectedFlag);
  const [query, setQuery] = useState('');
  const listId = useId();
  const nickRef = useRef<HTMLInputElement>(null);
  // Вікно відкрито дією людини (перше повідомлення): фокус одразу в полі ніка.
  useEffect(() => nickRef.current?.focus(), []);

  const special = (code: string) => c(`flags.${code}`);
  const trimmed = nick.trim();
  const issue: NickIssue | null = validateNick(nick, takenNicks) ?? forcedIssue ?? null;
  // «Коротко» показуємо лише після першої спроби; решта помилок — одразу.
  const shown: NickIssue | null = issue === 'short' ? (touched ? issue : null) : issue;
  const errorText = shown ? (shown === 'taken' ? t('taken') : shown === 'forbidden' ? t('forbidden') : shown === 'link' ? c('errors.link') : c('errors.short')) : undefined;

  const options = (() => {
    const q = query.trim().toLowerCase();
    const all: FlagOption[] = [
      ...SPECIAL_ALL.map((code) => ({ code, name: special(code) })),
      ...[...flags].sort((a, b) => a.name.localeCompare(b.name, 'uk')),
    ];
    const known = all.some((o) => o.code === flag) ? all : [{ code: flag, name: flagName(flag, flags, special) }, ...all];
    return q ? known.filter((o) => o.name.toLowerCase().includes(q)) : known;
  })();

  const submit = () => {
    setTouched(true);
    if (issue) return;
    onDone({ nick: trimmed, flagCode: flag });
  };

  const currentName = flagName(flag, flags, special);
  const undetected = !initialFlag && !detectedFlag;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-window="O-NICK"
      className={cn('flex flex-col gap-4', className)}
    >
      <TextField
        label={t('field')}
        value={nick}
        maxLength={NICK_MAX}
        counter
        ref={nickRef}
        autoComplete="nickname"
        hint={t('hint')}
        error={errorText}
        onChange={(e) => setNick(e.target.value)}
        onBlur={() => setTouched(true)}
      />

      <section aria-labelledby={`${listId}-flag`} className="flex flex-col gap-2">
        <div className="flex min-h-touch-min items-center gap-3">
          <h3 id={`${listId}-flag`} className="text-label-sm text-text-secondary">
            {c('flagLabel')}
          </h3>
          <span className="flex flex-1 items-center gap-2 text-body text-text">
            <Flag code={flag} size="sm" decorative />
            {currentName}
          </span>
          <Button type="button" variant="ghost" compact aria-expanded={choosing} aria-controls={listId} onClick={() => setChoosing((v) => !v)}>
            {c('change')}
          </Button>
        </div>
        <p className="text-caption text-text-muted">{undetected ? t('flagUnknown') : c('detected')}</p>
        {choosing ? (
          <div id={listId} className="flex flex-col gap-2">
            <TextField type="search" label={t('flagSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
            {options.length ? (
              <RadioGroup
                variant="list"
                label={c('flagList')}
                value={flag}
                onValueChange={setFlag}
                options={options.map((o) => ({ value: o.code, label: o.name }))}
                renderExtra={(o) => <Flag code={o.value} size="sm" decorative />}
                className="max-h-60 overflow-y-auto"
              />
            ) : (
              <p className="text-caption text-text-muted">{c('noFlags')}</p>
            )}
          </div>
        ) : null}
      </section>

      <section aria-label={t('previewLabel')} className="flex flex-col gap-1 rounded-md bg-surface px-3 py-2" data-row="preview">
        <p className="text-caption text-text-muted">{t('previewLabel')}</p>
        <p className="flex items-center gap-2 text-label-sm text-text">
          <Flag code={flag} size="xs" decorative />
          {trimmed || c('previewEmpty')}
        </p>
      </section>

      <Button type="submit" variant="coral" size="lg" className="w-full">
        {t('done')}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Вхід і пас — поза областю цієї збірки: кнопки лишаються на місці, дія з’явиться разом із ними. */}
        <Button type="button" variant="ghost" compact disabled>
          {t('signIn')}
        </Button>
        <Button type="button" variant="ghost" compact disabled>
          {t('whatPassGives')}
        </Button>
      </div>
      <p className="text-caption text-text-muted">
        {t('age')} · {c('termsLink')}
      </p>
    </form>
  );
}
