'use client';

/**
 * «Як тебе показувати» — крок після створення акаунта (дошка `Desk-Profile-Step`, рішення власника 2026-11-08): нік і прапор
 * одразу, щоб людина мала ім’я й прапор в аватарі, шапці й чаті, навіть якщо не пише в чаті. Нік підставлено (`suggestNick`):
 * гостьовий з чату → ім’я з Google → перше слово з пошти → «Гість NNNN»; прапор — за розташуванням, «Змінити» — той самий
 * список, що в O-NICK (`FlagField`). «Готово» — перевіряє й зберігає; «Пізніше» — лишає підставлене. Більше не питаємо.
 */
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { FlagField } from '@/components/windows/FlagField';
import { generatedNick, suggestNick } from '@/lib/auth/suggestNick';
import { validateNick, type NickIssue } from '@/lib/chat-sim/nick';
import { NICK_MAX } from '@/lib/chat-sim/send';
import { getData } from '@/lib/data/load';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useGuestStore } from '@/stores/guest';
import s from './auth.module.css';

export function ProfileForm({ email, googleName, stream, onDone }: { email: string; googleName?: string; stream: boolean; onDone: () => void }) {
  const t = useTranslations('auth.welcome');
  const w = useTranslations('windows.nick');
  const c = useTranslations('chat.nick');
  const setNickStore = useGuestStore((g) => g.setNick);
  const setDetected = useGuestStore((g) => g.setDetectedFlag);
  // Підставляємо раз — при відкритті кроку.
  const [initial] = useState(() => {
    const g = useGuestStore.getState();
    const suggested = suggestNick({ email, googleName, chatNick: g.nick });
    const source = g.nick && suggested === g.nick.trim() ? 'chat' : suggested ? (googleName ? 'google' : 'email') : 'gen';
    const detected = g.detectedFlag ?? detectFlag();
    return { nick: suggested ?? generatedNick(t('guestNick')), source, flag: g.flagCode ?? detected ?? 'earth', detected };
  });
  const [nick, setNick] = useState(initial.nick);
  const [flag, setFlag] = useState(initial.flag);
  const [touched, setTouched] = useState(false);
  const flags = useMemo(() => getData().countries.map((x) => ({ code: x.flagCode, name: x.name.uk })), []);

  const uid = useId();
  const issue: NickIssue | null = validateNick(nick);
  const shown = touched ? issue : null;
  const errorText = shown
    ? shown === 'forbidden'
      ? w('forbidden')
      : shown === 'link'
        ? c('errors.link')
        : shown === 'long'
          ? c('errors.long')
          : c('errors.short')
    : undefined;

  const save = (value: string) => {
    if (initial.detected) setDetected(initial.detected);
    setNickStore(value.trim(), flag);
    onDone();
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!issue) save(nick);
      }}
      className={s.profile}
      data-block="profile"
    >
      <h2 className={s.profileTitle}>{t('profileTitle')}</h2>
      <p className={s.profileLead}>{t('profileLead')}</p>

      <div className="mt-4 flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <label htmlFor={`${uid}-nick`} className="text-label-sm">
            {w('field')}
          </label>
          <span id={`${uid}-count`} className={cn('text-label-badge-chat tabular-nums', nick.length > NICK_MAX ? 'text-primary' : 'text-text-muted')}>
            {nick.length}/{NICK_MAX}
          </span>
        </div>
        <input
          id={`${uid}-nick`}
          type="text"
          value={nick}
          autoComplete="nickname"
          aria-invalid={errorText ? true : undefined}
          aria-describedby={[errorText ? `${uid}-err` : null, `${uid}-hint`, `${uid}-count`].filter(Boolean).join(' ')}
          onChange={(e) => setNick(e.target.value)}
          onBlur={() => setTouched(true)}
          className="t2f-nk-input"
        />
        <div aria-live="polite" id={`${uid}-err`}>
          {errorText ? (
            <p className="flex items-center gap-1 text-caption text-primary">
              <Icon name="alert" size={16} />
              {errorText}
            </p>
          ) : null}
        </div>
        <p id={`${uid}-hint`} className="t2f-nk-hint">
          {t(`nickFrom.${initial.source}`)}
        </p>
      </div>

      <FlagField value={flag} onChange={setFlag} detectedFlag={initial.detected} undetected={!initial.detected} flags={flags} measureKey={errorText} className="mt-3" />

      <div className={cn(s.profileFoot, stream && s.profileFootStream)}>
        <button type="submit" className={cn('t2f-focus', s.btn, s.coral, s.profileDone)}>
          {t('done')}
        </button>
        <button
          type="button"
          onClick={() => (issue ? onDone() : save(nick))}
          className={cn('t2f-focus', s.btn, s.ghost, s.profileLater)}
        >
          {t('later')}
        </button>
      </div>
    </form>
  );
}
