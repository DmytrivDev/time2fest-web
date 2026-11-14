'use client';

/**
 * Вміст кроків S-AUTH за дошками (`Phone-Auth-*`, `Desk-Auth-*`): вхід, реєстрація, Google (головна кнопка), код із 6 цифр
 * (рішення власника 2026-11-13: «надсилаємо…», поле коду, «перевіряємо…», код не підходить / згорів / прострочений, немає
 * зв’язку, «Надіслати ще раз» з відліком 30 с), забагато кодів, вхід недоступний (і «немає мережі» рядком під кнопкою),
 * «Акаунт створено».
 * `variant="stream"` — те саме у вікні під час трансляції: без «До трансляцій», пас — коротким рядком,
 * перемикання «вхід / реєстрація» — без переходу зі сторінки.
 * Коралова кнопка — одна на крок.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useEffect, useRef } from 'react';
import { cn } from '@/components/primitives/cn';
import { formatClock } from '@/lib/i18n/time';
import { useSession } from '@/lib/api/hooks/auth';
import {
  AccountPerks,
  AgeLine,
  Badge,
  Bold,
  BusyButton,
  CodeField,
  DemoCodeHint,
  EmailField,
  ErrorLine,
  GoogleButton,
  Lead,
  Note,
  PassHint,
  PassOfferCard,
  PassRow,
  ResendButton,
  Separator,
  SwitchRow,
  Title,
  TitleLevel,
  useTick,
} from './AuthParts';
import type { AuthFlow } from './useAuthFlow';
import { Icon } from '@/components/primitives/Icon';
import { ProfileForm } from './ProfileForm';
import s from './auth.module.css';

export interface AuthStepsProps {
  flow: AuthFlow;
  variant: 'page' | 'stream';
  /** Вікно: перемкнути вхід / реєстрацію на місці. Сторінка — посилання `/login/` ↔ `/signup/`. */
  onSwitchMode?: () => void;
  /** «До трансляцій» / «Повернутися до трансляції». */
  onExit: () => void;
  /** Сторінка: адреса повернення для посилань. */
  exitHref?: string;
}

export function AuthSteps({ flow, variant, onSwitchMode, onExit, exitHref = '/' }: AuthStepsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // Новий крок: на верх і фокус на заголовок (зчитувач чує, що змінилось).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const title = ref.current?.querySelector<HTMLElement>('[data-auth-title]');
    if (variant === 'page') window.scrollTo({ top: 0 });
    else ref.current?.closest('[data-scroll], .overflow-y-auto')?.scrollTo?.({ top: 0 });
    title?.focus({ preventScroll: true });
  }, [flow.step, variant]);

  const stream = variant === 'stream';
  return (
    <div ref={ref} className={cn('flex flex-col', stream && s.stream)} data-auth-step={flow.step.kind} data-auth-mode={flow.mode}>
      <TitleLevel.Provider value={stream ? 'h3' : 'h1'}>
        <Step flow={flow} stream={stream} onSwitchMode={onSwitchMode} onExit={onExit} exitHref={exitHref} />
      </TitleLevel.Provider>
    </div>
  );
}

function Step({ flow, stream, onSwitchMode, onExit, exitHref }: Omit<AuthStepsProps, 'variant'> & { stream: boolean }) {
  switch (flow.step.kind) {
    case 'form':
      return flow.mode === 'signup' ? (
        <SignupForm flow={flow} stream={stream} onSwitchMode={onSwitchMode} />
      ) : (
        <SigninForm flow={flow} stream={stream} onSwitchMode={onSwitchMode} />
      );
    case 'perks':
      return <PerksStep flow={flow} />;
    case 'google':
      return <GoogleStep flow={flow} stream={stream} />;
    case 'code':
      return <CodeStep flow={flow} />;
    case 'toomany':
      return <TooManyStep flow={flow} until={flow.step.until} />;
    case 'unavailable':
      return <UnavailableStep flow={flow} onExit={onExit} exitHref={stream ? undefined : exitHref} />;
    case 'welcome':
      return <WelcomeStep email={flow.step.email} stream={stream} onExit={onExit} />;
  }
}

function useEmailError(flow: AuthFlow): string | null {
  const t = useTranslations('auth.email');
  return flow.emailIssue ? t(flow.emailIssue) : null;
}

function OfflineLine({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth.unavailable');
  const c = useTranslations('auth.code');
  if (flow.sendFailed) return <ErrorLine mt={12}>{c('sendFailedNetwork')}</ErrorLine>;
  return flow.offlinePending ? (
    <p role="status" className={s.note} style={{ marginTop: '0.75rem' }}>
      <Icon name="cloud-off" size={18} />
      <span>{t('offline')}</span>
    </p>
  ) : null;
}

function GoogleFailed({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth.google');
  return flow.googleFailed ? <ErrorLine mt={12}>{t('failed')}</ErrorLine> : null;
}

function onSubmit(flow: AuthFlow) {
  return (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!flow.sending) flow.submitEmail();
  };
}

function SigninForm({ flow, stream, onSwitchMode }: { flow: AuthFlow; stream: boolean; onSwitchMode?: () => void }) {
  const t = useTranslations('auth');
  const err = useEmailError(flow);
  return (
    <form noValidate onSubmit={onSubmit(flow)} className="flex flex-col">
      {stream ? (
        <StreamIntro flow={flow} />
      ) : (
        <>
          <Title>{t('signin.title')}</Title>
          <Lead>{t('signin.lead')}</Lead>
        </>
      )}
      <GoogleFailed flow={flow} />
      <GoogleButton primary label={t('signin.google')} onClick={flow.startGoogle} className={stream ? s.mt16 : s.mt24} />
      <Separator label={t('signin.orEmail')} margin={stream ? '16px 0' : undefined} />
      <EmailField
        value={flow.email}
        onChange={flow.setEmail}
        error={err}
        hint={stream ? t('email.hintStream') : t('email.hint')}
        readOnly={flow.sending}
      />
      <BusyButton busy={flow.sending} busyLabel={t('sending')} className={stream ? s.mt12 : s.mt16} action="send-code">
        {t('email.submit')}
      </BusyButton>
      <OfflineLine flow={flow} />
      <SwitchRow
        question={t('signin.noAccount')}
        label={t('signin.createLink')}
        href="/signup/"
        onClick={onSwitchMode}
        mt={stream ? 8 : undefined}
      />
      {stream ? <PassRow /> : <PassHint toPage />}
      <AgeLine mode="signin" mt={stream ? 8 : undefined} />
    </form>
  );
}

function SignupForm({ flow, stream, onSwitchMode }: { flow: AuthFlow; stream: boolean; onSwitchMode?: () => void }) {
  const t = useTranslations('auth');
  const err = useEmailError(flow);
  return (
    <form noValidate onSubmit={onSubmit(flow)} className="flex flex-col">
      {stream ? (
        <StreamIntro flow={flow} />
      ) : (
        <>
          <Title>{t('signup.title')}</Title>
          <Lead>{t('signup.lead')}</Lead>
        </>
      )}
      <GoogleFailed flow={flow} />
      <GoogleButton primary label={t('signup.google')} onClick={flow.startGoogle} className={stream ? s.mt16 : s.mt24} />
      <Separator label={t('signin.orEmail')} margin={stream ? '16px 0' : undefined} />
      <EmailField value={flow.email} onChange={flow.setEmail} error={err} hint={t('email.hintSignup')} readOnly={flow.sending} />
      <BusyButton busy={flow.sending} busyLabel={t('sending')} className={stream ? s.mt12 : s.mt16} action="send-code">
        {t('email.submit')}
      </BusyButton>
      <OfflineLine flow={flow} />
      <SwitchRow
        question={t('signup.haveAccount')}
        label={t('signup.signinLink')}
        href="/login/"
        onClick={onSwitchMode}
        mt={12}
      />
      {stream ? <PassRow /> : <PassHint toPage />}
      <AgeLine mode="signup" mt={stream ? 8 : undefined} />
    </form>
  );
}

/** Вікно під трансляцією: вступ і «Що дає акаунт». */
function StreamIntro({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth.stream');
  return (
    <div className={s.streamIntro}>
      <p className={s.streamLead}>{t('lead')}</p>
      <button type="button" onClick={() => flow.setStep({ kind: 'perks' })} className={cn('t2f-focus', s.linkBtn, s.linkStart)}>
        {t('perks')}
      </button>
    </div>
  );
}

/** «Що дає акаунт» у вікні під трансляцією: можливості акаунта, картка пасу, повернення до форми. */
function PerksStep({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth');
  const back = () => flow.setStep({ kind: 'form' });
  return (
    <div className="flex flex-col">
      <button type="button" onClick={back} className={cn('t2f-focus', s.linkBtn, s.linkStart, s.backBtn)}>
        <Icon name="chevron-left" size={16} strokeWidth={2} />
        {t('stream.back')}
      </button>
      <Title>{t('stream.perksTitle')}</Title>
      <AccountPerks />
      <PassHint className={s.mt12} />
      <button type="button" onClick={back} className={cn('t2f-focus', s.btn, s.coral, s.mt20)}>
        {flow.mode === 'signup' ? t('signup.submit') : t('signin.title')}
      </button>
    </div>
  );
}

function GoogleStep({ flow, stream }: { flow: AuthFlow; stream: boolean }) {
  const t = useTranslations('auth');
  const err = useEmailError(flow);
  return (
    <form noValidate onSubmit={onSubmit(flow)} className="flex flex-col">
      <span aria-hidden="true" className={cn(s.badge, s.grey, stream ? undefined : s.pageTop)}>
        <GoogleIconLg />
      </span>
      <Title afterBadge>{t('google.title')}</Title>
      <Lead>{t('google.lead')}</Lead>
      <div role="progressbar" aria-label={t('google.progress')} className={s.progress}>
        <span />
      </div>
      <button type="button" onClick={flow.cancelGoogle} className={cn('t2f-focus', s.btn, s.ghost, s.mt24)}>
        {t('google.cancel')}
      </button>
      <Note icon="alert-bold">{t('google.note')}</Note>
      <Separator label={t('google.or')} margin="20px 0 16px" />
      <EmailField value={flow.email} onChange={flow.setEmail} error={err} hint={t('email.hint')} readOnly={flow.sending} />
      <BusyButton busy={flow.sending} busyLabel={t('sending')} className={s.mt16} action="send-code">
        {t('email.submit')}
      </BusyButton>
      <OfflineLine flow={flow} />
    </form>
  );
}

function GoogleIconLg() {
  return (
    <svg width="1.625rem" height="1.625rem" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.4 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.3a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 2.9-4.3 2.9-7.3zM12 21.8c2.7 0 4.9-.9 6.5-2.4l-3.2-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3.2v2.6A9.8 9.8 0 0 0 12 21.8zM6.5 13.9a5.9 5.9 0 0 1 0-3.8V7.5H3.2a9.8 9.8 0 0 0 0 8.9zM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2.2a9.8 9.8 0 0 0-8.8 5.3l3.3 2.6c.8-2.3 2.9-4 5.5-4z"
      />
    </svg>
  );
}

/** Помилка під полем коду за станом. */
function useCodeError(flow: AuthFlow): string | null {
  const t = useTranslations('auth.code');
  const st = flow.codeState;
  if (st.kind === 'wrong') return t('wrong', { left: st.left });
  if (st.kind === 'too-many') return t('tooMany');
  if (st.kind === 'expired') return t('expired');
  if (st.kind === 'network') return t('network');
  return null;
}

/**
 * «Введи код із листа»: одне поле на 6 цифр, вхід на 6-й цифрі; «Перевіряємо…»; помилки (не підходить — скільки спроб
 * лишилось; 5 невдалих — код згорів; минуло 10 хв — прострочений; немає зв’язку — «Спробувати ще»); «Надіслати ще раз»
 * з відліком 30 с; «Змінити пошту». Згорілий чи прострочений код — головна дія «Надіслати новий код».
 */
function CodeStep({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth');
  const st = flow.codeState;
  const error = useCodeError(flow);
  const email = flow.codeEmail;
  const dead = st.kind === 'too-many' || st.kind === 'expired';
  const checking = st.kind === 'checking';
  return (
    <form
      noValidate
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (dead) void flow.send(email, { resend: true });
        else void flow.verify(flow.code);
      }}
    >
      <Badge icon="envelope" className={s.pageTop} />
      <Title afterBadge>{t('code.title')}</Title>
      <Lead>{t.rich('code.lead', { email, b: Bold })}</Lead>
      <button type="button" onClick={flow.changeEmail} className={cn('t2f-focus', s.linkBtn, s.linkStart)} data-action="change-email">
        {t('code.change')}
      </button>
      <div className={s.mt12}>
        <CodeField
          label={t('code.label')}
          value={flow.code}
          onChange={flow.setCode}
          error={error}
          status={checking ? t('code.checking') : null}
          disabled={dead}
          focusOnMount
        />
        <DemoCodeHint />
      </div>
      {dead ? (
        <BusyButton busy={flow.sending} busyLabel={t('sending')} tone="coral" className={s.mt16} action="new-code">
          {t('code.newCode')}
        </BusyButton>
      ) : st.kind === 'network' ? (
        <BusyButton busy={false} busyLabel={t('code.checking')} tone="coral" className={s.mt16} action="verify">
          <Icon name="refresh" size={20} />
          {t('code.retry')}
        </BusyButton>
      ) : (
        <BusyButton busy={checking} busyLabel={t('code.checking')} tone="coral" className={s.mt16} action="verify">
          {t('code.submit')}
        </BusyButton>
      )}
      {dead ? null : (
        <>
          <p className={s.hint} style={{ marginTop: '0.75rem' }}>
            {t('code.spam')}
          </p>
          <ResendButton
            until={flow.codeInfo?.resendAt ?? null}
            busy={flow.sending}
            onResend={() => void flow.send(email, { resend: true })}
            className={s.mt12}
          />
        </>
      )}
      <ResendLine flow={flow} email={email} />
      <Note icon="moon" mt={20}>
        {t('code.stay')}
      </Note>
    </form>
  );
}

/** Що сталося з «Надіслати ще раз»: надіслано (видно й оголошено), немає зв’язку, забагато кодів. */
function ResendLine({ flow, email }: { flow: AuthFlow; email: string }) {
  const t = useTranslations('auth.code');
  const r = flow.resend;
  if (r.kind === 'network') return <ErrorLine mt={10}>{t('resendNetwork')}</ErrorLine>;
  if (r.kind === 'limited') return <ErrorLine mt={10}>{t.rich('resendLimited', { time: formatClock(r.until), b: Bold })}</ErrorLine>;
  return (
    <p role="status" className={r.kind === 'sent' ? s.okLine : 'sr-only'}>
      {r.kind === 'sent' ? (
        <>
          <Icon name="check-circle" size={18} />
          <span>{t('resent', { email })}</span>
        </>
      ) : null}
    </p>
  );
}

function TooManyStep({ flow, until }: { flow: AuthFlow; until: number }) {
  const t = useTranslations('auth');
  const now = useTick(true);
  const left = until - now;
  const time = formatClock(until);
  const email = flow.codeInfo?.email ?? flow.email;
  return (
    <div className="flex flex-col">
      <Title>{t('signin.title')}</Title>
      <Lead>{t('tooMany.lead')}</Lead>
      <div role="alert" className={s.alertBox}>
        <Icon name="clock-wide" size={20} />
        <span className={s.boxBody}>
          <span className={s.boxTitle}>{t('tooMany.title')}</span>
          <span className={s.boxText}>
            {t.rich('tooMany.text', { minutes: Math.max(1, Math.ceil(left / 60_000)), time, b: Bold })}
          </span>
        </span>
      </div>
      <div className="mt-5 flex flex-col">
        <EmailField value={email} onChange={flow.setEmail} hint={t('tooMany.fieldHint')} />
      </div>
      {left > 0 ? (
        <button type="button" aria-disabled="true" onClick={(e) => e.preventDefault()} className={cn('t2f-focus', s.btn, s.disabled, s.mt16)}>
          {t('tooMany.sendAt', { time })}
        </button>
      ) : (
        <BusyButton type="button" busy={flow.sending} busyLabel={t('sending')} tone="coral" onClick={() => flow.submitEmail()} className={s.mt16} action="send-code">
          {t('email.submit')}
        </BusyButton>
      )}
      <Separator label={t('tooMany.meanwhile')} margin="20px 0 16px" />
      <GoogleButton primary={left > 0} label={t('signin.google')} onClick={flow.startGoogle} />
      <Note icon="chat">{t('tooMany.note')}</Note>
    </div>
  );
}

function UnavailableStep({ flow, onExit, exitHref }: { flow: AuthFlow; onExit: () => void; exitHref?: string }) {
  const t = useTranslations('auth.unavailable');
  return (
    <div className="flex flex-col">
      <Badge icon="cloud-off" tone="grey" className={s.pageTop} />
      <Title afterBadge>{t('title')}</Title>
      <Lead>{t('lead')}</Lead>
      <button
        type="button"
        onClick={() => {
          flow.setStep({ kind: 'form' });
          if (flow.email) flow.submitEmail();
        }}
        className={cn('t2f-focus', s.btn, s.second, s.mt24)}
      >
        <Icon name="refresh" size={20} />
        {t('retry')}
      </button>
      {exitHref ? (
        <NextLink href={exitHref} className={cn('t2f-focus', s.btn, s.ghost, s.mt12)}>
          {t('toLive')}
        </NextLink>
      ) : (
        <button type="button" onClick={onExit} className={cn('t2f-focus', s.btn, s.ghost, s.mt12)}>
          {t('toLive')}
        </button>
      )}
    </div>
  );
}

function WelcomeStep({ email, stream, onExit }: { email: string; stream: boolean; onExit: () => void }) {
  const t = useTranslations('auth.welcome');
  const user = useSession().session?.user;
  const google = user?.via === 'google';
  // Крок «Як тебе показувати» (дошка `Desk-Profile-Step`, 2026-11-08): нік і прапор одразу; «Готово» / «Пізніше» — далі як було.
  return (
    <div className="flex flex-col">
      <Badge icon="check-circle" className={s.pageTop} />
      <Title afterBadge>{t('title')}</Title>
      <Lead>{t.rich(google ? 'leadGoogle' : 'lead', { email, b: Bold })}</Lead>
      <ProfileForm email={email} googleName={google ? user?.name : undefined} stream={stream} onDone={onExit} />
      {stream ? null : <PassOfferCard welcome toPage className="mt-6" />}
    </div>
  );
}
