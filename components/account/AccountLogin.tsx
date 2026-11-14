'use client';

/** Блок «Як ти входиш» у профілі кабінету: Google, зміна пошти кодом, «Вийти на всіх». */

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { BusyButton, CodeField, DemoCodeHint, ResendButton } from '@/components/auth/AuthParts';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { authCodeError } from '@/lib/api/contracts/auth';
import { authActions, profileActions, useProfile, useSession } from '@/lib/api/hooks/auth';
import { formatClock } from '@/lib/i18n/time';
import { Row } from './AccountParts';
import s from './account.module.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * «Як ти входиш»: Google — першим (головний спосіб, рішення власника 2026-11-13), далі пошта, далі «Вийти на всіх».
 * Зміна пошти — тим самим кодом із 6 цифр, що й вхід: нова адреса → «Надіслати код» («Надсилаємо…») → поле коду
 * (вхід на 6-й цифрі, «Перевіряємо…», помилки, «Надіслати ще раз» з відліком) → «Пошту змінено». Рядки — під лінією
 * `.rows`, тож підзаголовок «Пароля немає…» не налазить на першу лінію (перевірка дошок 2026-11-14).
 */
export function AccountLogin() {
  const t = useTranslations('account.login');
  const tc = useTranslations('auth.code');
  const router = useRouter();
  const user = useSession().session?.user ?? null;
  const profile = useProfile();
  const googleLinked = profile?.googleLinked ?? false;
  const pending = profile?.pendingEmail ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<ReactNode>(null);
  const [sending, setSending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<{ text: string; dead: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [changed, setChanged] = useState<string | null>(null);
  const google = user?.via === 'google';
  const email = user?.email ?? '';

  /** Відмова надсилання коду → рядок під полем. */
  const sendError = (e: Parameters<typeof authCodeError>[0], now: number): ReactNode => {
    if (e.reason === 'same-email') return t('emailSame');
    if (e.reason === 'taken') return t('emailTaken');
    if (e.reason === 'email') return t('emailInvalid');
    const kind = authCodeError(e);
    if (kind === 'rate-limited') return t.rich('sendLimited', { time: formatClock(now + (e.retryAfterMs ?? 0)), b: (x) => <b>{x}</b> });
    if (kind === 'unavailable') return t('unavailable');
    return t('sendFailed');
  };

  const send = async (to: string) => {
    if (sending) return;
    setSending(true);
    setError(null);
    const now = Date.now();
    const res = await profileActions.changeEmail(to);
    setSending(false);
    if (!res.ok) {
      // Код на цю адресу щойно йшов — лишаємо поле коду з відліком.
      if (authCodeError(res.error) === 'cooldown') return;
      setError(sendError(res.error, now));
      return;
    }
    setEditing(false);
    setValue('');
    setCode('');
    setCodeError(null);
    setChanged(null);
  };
  const submit = () => {
    const v = value.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setError(t('emailInvalid'));
    if (v === email) return setError(t('emailSame'));
    void send(v);
  };
  const verify = async (digits: string) => {
    if (checking || !pending) return;
    setChecking(true);
    setCodeError(null);
    const target = pending.email;
    const res = await profileActions.confirmEmailChange(digits);
    setChecking(false);
    if (res.ok) {
      setCode('');
      setChanged(target);
      return;
    }
    const kind = authCodeError(res.error);
    if (kind === 'wrong-code') {
      setCode('');
      setCodeError({ text: tc('wrong', { left: res.error.attemptsLeft ?? 0 }), dead: false });
    } else if (kind === 'too-many-attempts') setCodeError({ text: tc('tooMany'), dead: true });
    else if (kind === 'expired') setCodeError({ text: tc('expired'), dead: true });
    else setCodeError({ text: tc('network'), dead: false });
  };
  const typeCode = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (codeError && !codeError.dead) setCodeError(null);
    if (digits.length === 6) void verify(digits);
  };
  const connect = () => {
    setConnecting(true);
    void profileActions.linkGoogle().then(() => setConnecting(false));
  };

  return (
    <div className={s.login} data-block="login">
      <h3 className={s.h3}>{t('title')}</h3>
      <p className={s.lead}>{google ? t('noteGoogle') : t('noteEmail')}</p>

      <div className={s.rows}>
        <Row title={t('google')} hint={google || googleLinked ? t('googleOn') : connecting ? t('googleConnecting') : t('googleOff')}>
          {google ? (
            <span className={s.ok}>{t('googleLinked')}</span>
          ) : googleLinked ? (
            <span className={s.acts}>
              <span className={s.ok}>{t('googleLinked')}</span>
              <button type="button" onClick={() => void profileActions.unlinkGoogle()} className={cn('t2f-focus', s.link)}>
                {t('googleDisconnect')}
              </button>
            </span>
          ) : (
            <button type="button" disabled={connecting} onClick={connect} className={cn('t2f-focus t2f-transition', s.btn, s.coral)} data-action="google-connect">
              {connecting ? <span className={s.spin} aria-hidden="true" /> : null}
              {t('googleConnect')}
            </button>
          )}
        </Row>

        <Row title={t('email')} hint={google ? t('emailGoogle', { email }) : t('emailHint', { email })}>
          {!google && !editing && !pending ? (
            <button type="button" onClick={() => setEditing(true)} className={cn('t2f-focus', s.link)} data-action="change-email">
              {t('change')}
            </button>
          ) : null}
        </Row>
        {changed && !pending ? (
          <p className={cn(s.saved, s.saveLine)} role="status" data-email-changed="">
            <Icon name="check" size={16} />
            {t('emailChanged', { email: changed })}
          </p>
        ) : null}
        <div className="t2f-reveal" data-open={editing && !pending}>
          <div className="t2f-reveal-inner">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className={s.inline}
            >
              <label className={s.label} htmlFor="acc-new-email">
                {t('newEmail')}
              </label>
              <input
                id="acc-new-email"
                type="email"
                value={value}
                readOnly={sending}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                aria-invalid={error ? true : undefined}
                className="t2f-nk-input"
                autoComplete="email"
              />
              <p className={error ? s.err : s.hint} aria-live="polite">
                {error ?? t('emailWait')}
              </p>
              <div className={s.inlineActs}>
                <button type="submit" aria-busy={sending || undefined} className={cn('t2f-focus t2f-transition', s.btn, s.coral)} data-action="send-code">
                  {sending ? <span className={s.spin} aria-hidden="true" /> : null}
                  {sending ? tc('sendingShort') : t('sendConfirm')}
                </button>
                <button type="button" onClick={() => setEditing(false)} className={cn('t2f-focus', s.link)}>
                  {t('cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
        {pending ? (
          <div className={s.notice} role="status" data-block="email-code">
            <Icon name="at" size={18} />
            <div className="min-w-0 flex-1">
              {t.rich('emailSent', { email: pending.email, b: (x) => <b>{x}</b> })}
              <form
                noValidate
                className={s.codeBox}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (codeError?.dead) void send(pending.email);
                  else void verify(code);
                }}
              >
                <CodeField
                  label={t('codeLabel')}
                  value={code}
                  onChange={typeCode}
                  error={codeError?.text}
                  status={checking ? t('checking') : null}
                  disabled={codeError?.dead}
                  focusOnMount
                />
                <DemoCodeHint purpose="email-change" />
                {codeError?.dead ? (
                  <BusyButton busy={sending} busyLabel={tc('sendingShort')} tone="coral" action="new-code">
                    {tc('newCode')}
                  </BusyButton>
                ) : (
                  <BusyButton busy={checking} busyLabel={t('checking')} tone="coral" action="verify">
                    {t('codeConfirm')}
                  </BusyButton>
                )}
                {codeError?.dead ? null : <ResendButton until={pending.resendAt} busy={sending} onResend={() => void send(pending.email)} />}
                {error ? (
                  <p className={s.err} role="alert">
                    {error}
                  </p>
                ) : null}
              </form>
              <div className={s.noticeActs}>
                <button type="button" onClick={() => void profileActions.cancelEmailChange()} className={cn('t2f-focus', s.link)}>
                  {t('cancelChange')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <Row title={t('devices')} hint={t('devicesHint')}>
          <button
            type="button"
            onClick={() => {
              void authActions.signOut();
              router.push('/');
            }}
            className={cn('t2f-focus', s.link)}
          >
            {t('signOutAll')}
          </button>
        </Row>
      </div>
    </div>
  );
}
