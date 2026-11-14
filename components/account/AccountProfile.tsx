'use client';

/** Розділ «Профіль» кабінету: аватар, нік і прапор із записом на сервер, плашка пасу, блок «Як ти входиш». */

import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { useHeaderUser } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { HeaderAvatar } from '@/components/shell/Header';
import { FlagField } from '@/components/windows/FlagField';
import { profileActions, useProfile, useSession } from '@/lib/api/hooks/auth';
import { validateNick, type NickIssue } from '@/lib/chat/nick';
import { NICK_MAX } from '@/lib/chat/send';
import { getData } from '@/lib/data/load';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useGuestStore } from '@/stores/guest';
import { AccountLogin } from './AccountLogin';
import { PassPlaque } from './PassPlaque';
import { useSave } from './useSave';
import s from './account.module.css';

export function AccountProfile({ hasPass }: { hasPass: boolean }) {
  const t = useTranslations('account');
  const w = useTranslations('windows.nick');
  const c = useTranslations('chat.nick');
  const th = useTranslations('header');
  const user = useHeaderUser()!;
  const email = useSession().session?.user?.email ?? '';
  // Профіль — з сервісу (`peek`: значення є вже в першому кадрі, тож початкові значення полів ті самі).
  const profile = useProfile();
  const storedNick = profile?.nick ?? undefined;
  const storedFlag = profile?.flagCode ?? profile?.detectedFlag ?? undefined;
  const detected = useMemo(() => useGuestStore.getState().detectedFlag ?? detectFlag(), []);
  const [nick, setNick] = useState(storedNick ?? user.name);
  const [flag, setFlag] = useState(storedFlag ?? detected ?? 'earth');
  const [touched, setTouched] = useState(false);
  const save = useSave();
  const sv = useTranslations('account.save');
  const saved = save.state === 'saved';
  const setSaved = (v: boolean) => {
    if (!v) save.reset();
  };
  const flags = useMemo(() => getData().countries.map((x) => ({ code: x.flagCode, name: x.name.uk })), []);
  const uid = useId();
  const issue: NickIssue | null = validateNick(nick);
  const err = touched && issue ? (issue === 'forbidden' ? w('forbidden') : issue === 'link' ? c('errors.link') : issue === 'long' ? c('errors.long') : c('errors.short')) : undefined;
  const dirty = nick.trim() !== (storedNick ?? user.name) || flag !== (storedFlag ?? detected ?? 'earth');

  return (
    <section id="profile" aria-labelledby="profile-h" className={s.card}>
      <h2 id="profile-h" className={s.h2}>
        {t('profile.title')}
      </h2>
      <p className={s.lead}>{t('profile.lead')}</p>

      <div className={s.who}>
        <span className={s.bigAvatar}>
          <HeaderAvatar user={{ name: nick.trim() || user.name, flag }} pass={hasPass} label={th('passLabel')} />
        </span>
        <div className={s.whoText}>
          <div className={s.whoName}>{storedNick ?? user.name}</div>
          <div className={s.whoEmail} title={email}>
            {email}
          </div>
          <span className={cn(s.chip, hasPass ? s.chipOn : s.chipOff)}>
            <Icon name="ticket" size={14} />
            {hasPass ? t('profile.passActive') : t('profile.passInactive')}
          </span>
        </div>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (issue || save.state === 'saving') return;
          void save.run(profileActions.update({ nick: nick.trim(), flagCode: flag }));
        }}
        className={s.form}
      >
        <div className={s.field}>
          <div className={s.fieldHead}>
            <label htmlFor={`${uid}-nick`} className={s.label}>
              {t('profile.nick')}
            </label>
            <span className={s.count}>
              {nick.length}/{NICK_MAX}
            </span>
          </div>
          <input
            id={`${uid}-nick`}
            value={nick}
            autoComplete="nickname"
            aria-invalid={err ? true : undefined}
            aria-describedby={`${uid}-nick-hint`}
            onChange={(e) => {
              setNick(e.target.value);
              setSaved(false);
            }}
            onBlur={() => setTouched(true)}
            className="t2f-nk-input"
          />
          <p id={`${uid}-nick-hint`} className={err ? s.err : s.hint} aria-live="polite">
            {err ?? t('profile.nickHint')}
          </p>
        </div>
        <div className={s.field}>
          <FlagField
            value={flag}
            onChange={(v) => {
              setFlag(v);
              setSaved(false);
            }}
            detectedFlag={detected}
            undetected={!detected}
            flags={flags}
          />
        </div>
        <div className={s.formFoot}>
          {saved && !dirty ? (
            <span className={s.saved} role="status">
              <Icon name="check" size={16} />
              {t('profile.saved')}
            </span>
          ) : null}
          {save.state === 'failed' ? (
            <span className={s.err} role="alert" data-save="failed">
              {sv('failed')}
            </span>
          ) : null}
          <button
            type="submit"
            disabled={!dirty && save.state !== 'saving'}
            aria-busy={save.state === 'saving' || undefined}
            className={cn('t2f-focus t2f-transition', s.btn, s.coral)}
          >
            {save.state === 'saving' ? <span className={s.spin} aria-hidden="true" /> : null}
            {save.state === 'saving' ? sv('saving') : t('profile.save')}
          </button>
        </div>
      </form>

      <PassPlaque hasPass={hasPass} />
      <AccountLogin />
    </section>
  );
}
