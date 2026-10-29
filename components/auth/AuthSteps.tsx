'use client';

/**
 * Вміст кроків S-AUTH за дошками (`Phone-Auth-*`, `Desk-Auth-*`): вхід, реєстрація, Google, лист надіслано, код
 * (і неправильний код), посилання не діє, забагато спроб, вхід недоступний (і «немає мережі» рядком під кнопкою),
 * посилання відкрито на іншому пристрої, «Акаунт створено».
 * `variant="stream"` — те саме у вікні під час трансляції: без «До трансляцій», пас — коротким рядком,
 * перемикання «вхід / реєстрація» — без переходу зі сторінки.
 * Коралова кнопка — одна на крок.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useEffect, useRef } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { IS_TEST_BUILD } from '@/lib/env';
import { formatClock, LETTER_TTL_MS, RESEND_GAP_MS } from '@/lib/auth/sim';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import {
  AgeLine,
  Badge,
  Bold,
  CodeField,
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
import { AuthIcon } from './icons';
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
    case 'google':
      return <GoogleStep flow={flow} stream={stream} />;
    case 'sent':
      return <SentStep flow={flow} />;
    case 'code':
      return <CodeStep flow={flow} />;
    case 'expired':
      return <ExpiredStep flow={flow} email={flow.step.email} />;
    case 'toomany':
      return <TooManyStep flow={flow} until={flow.step.until} />;
    case 'unavailable':
      return <UnavailableStep flow={flow} onExit={onExit} exitHref={stream ? undefined : exitHref} />;
    case 'otherDevice':
      return <OtherDeviceStep email={flow.step.email} validUntil={flow.step.validUntil} exitHref={exitHref!} />;
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
  return flow.offlinePending ? (
    <p role="status" className={s.note} style={{ marginTop: 12 }}>
      <AuthIcon name="cloud-off" size={18} />
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
    flow.submitEmail();
  };
}

function SigninForm({ flow, stream, onSwitchMode }: { flow: AuthFlow; stream: boolean; onSwitchMode?: () => void }) {
  const t = useTranslations('auth');
  const err = useEmailError(flow);
  return (
    <form noValidate onSubmit={onSubmit(flow)} className="flex flex-col">
      {stream ? (
        <p className={s.streamLead}>{t('stream.lead')}</p>
      ) : (
        <>
          <Title>{t('signin.title')}</Title>
          <Lead>{t('signin.lead')}</Lead>
        </>
      )}
      <GoogleFailed flow={flow} />
      <GoogleButton label={t('signin.google')} onClick={flow.startGoogle} className={stream ? s.mt16 : s.mt24} />
      <Separator label={t('signin.orEmail')} margin={stream ? '16px 0' : undefined} />
      <EmailField
        value={flow.email}
        onChange={flow.setEmail}
        error={err}
        hint={stream ? t('email.hintStream') : t('email.hint')}
      />
      <button type="submit" className={cn('t2f-focus', s.btn, s.coral, stream ? s.mt12 : s.mt16)}>
        {t('signin.send')}
      </button>
      <OfflineLine flow={flow} />
      <SwitchRow
        question={t('signin.noAccount')}
        label={t('signin.createLink')}
        href="/signup/"
        onClick={onSwitchMode}
        mt={stream ? 8 : undefined}
      />
      {stream ? <PassRow /> : <PassHint />}
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
        <p className={s.streamLead}>{t('stream.lead')}</p>
      ) : (
        <>
          <Title>{t('signup.title')}</Title>
          <Lead>
            <span className="lg:hidden">{t('signup.leadPhone')}</span>
            <span className="max-lg:hidden">{t('signup.leadDesk')}</span>
          </Lead>
          {/* Телефон: пропозиція пасу в потоці; десктоп — у лівій колонці (AuthPage). */}
          <div className={cn(s.phoneOnly, 'mt-5 flex flex-col')}>
            <PassOfferCard />
            <Separator label={t('signup.orFree')} margin="24px 0 0" />
          </div>
        </>
      )}
      <GoogleFailed flow={flow} />
      <GoogleButton label={t('signup.google')} onClick={flow.startGoogle} className={stream ? s.mt16 : s.signupGoogle} />
      <Separator label={t('signin.orEmail')} margin={stream ? '16px 0' : undefined} />
      <EmailField value={flow.email} onChange={flow.setEmail} error={err} hint={t('email.hintSignup')} />
      <button type="submit" className={cn('t2f-focus', s.btn, s.coral, stream ? s.mt12 : s.mt16)}>
        {t('signup.submit')}
      </button>
      <OfflineLine flow={flow} />
      <SwitchRow
        question={t('signup.haveAccount')}
        label={t('signup.signinLink')}
        href="/login/"
        onClick={onSwitchMode}
        mt={12}
      />
      {stream ? <PassRow /> : null}
      <AgeLine mode="signup" mt={stream ? 8 : 12} />
    </form>
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
      <Note icon="alert">{t('google.note')}</Note>
      <Separator label={t('google.or')} margin="20px 0 16px" />
      <EmailField value={flow.email} onChange={flow.setEmail} error={err} hint={t('email.hint')} />
      <button type="submit" className={cn('t2f-focus', s.btn, s.second, s.mt16)}>
        {t('signin.send')}
      </button>
      <OfflineLine flow={flow} />
    </form>
  );
}

function GoogleIconLg() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.4 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.3a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 2.9-4.3 2.9-7.3zM12 21.8c2.7 0 4.9-.9 6.5-2.4l-3.2-2.5c-.9.6-2 1-3.3 1-2.6 0-4.7-1.7-5.5-4H3.2v2.6A9.8 9.8 0 0 0 12 21.8zM6.5 13.9a5.9 5.9 0 0 1 0-3.8V7.5H3.2a9.8 9.8 0 0 0 0 8.9zM12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2.2a9.8 9.8 0 0 0-8.8 5.3l3.3 2.6c.8-2.3 2.9-4 5.5-4z"
      />
    </svg>
  );
}

function resendUntil(flow: AuthFlow): number | null {
  return flow.letter ? flow.letter.sentAt + RESEND_GAP_MS : null;
}

function SentStep({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth.sent');
  const email = flow.letter?.email ?? flow.email;
  return (
    <div className="flex flex-col">
      <Badge icon="mail" className={s.pageTop} />
      <Title afterBadge>{t('title')}</Title>
      <Lead>{t.rich('lead', { email, b: Bold })}</Lead>
      <button type="button" onClick={flow.changeEmail} className={cn('t2f-focus', s.linkBtn, s.linkStart)}>
        {t('change')}
      </button>
      <p className={s.hint} style={{ marginTop: 4 }}>
        {t('spam')}
      </p>
      <button type="button" onClick={() => flow.setStep({ kind: 'code' })} className={cn('t2f-focus', s.btn, s.second, s.mt20)}>
        <AuthIcon name="keypad" />
        {t('enterCode')}
      </button>
      <ResendButton until={resendUntil(flow)} onResend={() => flow.send(email, { resend: true })} className={s.mt12} />
      <Resent flow={flow} email={email} />
      <Note icon="moon" mt={24}>
        {t('stay')}
      </Note>
      <TestMailbox />
    </div>
  );
}

function Resent({ flow, email }: { flow: AuthFlow; email: string }) {
  const t = useTranslations('auth.sent');
  return (
    <p role="status" className="sr-only">
      {flow.resentAt ? t('resent', { email }) : ''}
    </p>
  );
}

function CodeStep({ flow }: { flow: AuthFlow }) {
  const t = useTranslations('auth');
  const email = flow.letter?.email ?? flow.email;
  const issue = flow.codeIssue;
  const failed = issue === 'wrong' || issue === 'expired' || issue === 'burned';
  const errText = issue ? t(`code.${issue}`) : null;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        flow.submitCode();
      }}
      className="flex flex-col"
    >
      <Title>{t('code.title')}</Title>
      <Lead>{t.rich('code.lead', { email, b: Bold })}</Lead>
      <button type="button" onClick={flow.changeEmail} className={cn('t2f-focus', s.linkBtn, s.linkStart)}>
        {t('sent.change')}
      </button>
      <CodeField
        value={flow.code}
        onChange={flow.setCode}
        onComplete={(v) => flow.submitCode(v)}
        error={failed}
        describedBy={[errText ? 'auth-code-err' : null, 'auth-code-hint'].filter(Boolean).join(' ')}
      />
      {errText ? (
        <ErrorLine id="auth-code-err" mt={10}>
          {errText}
        </ErrorLine>
      ) : null}
      <p id="auth-code-hint" className={s.hint} style={failed ? undefined : { marginTop: 8 }}>
        {failed ? t('code.errorHint') : t('code.hint')}
      </p>
      <button type="submit" className={cn('t2f-focus', s.btn, s.coral, s.mt20)}>
        {t('code.submit')}
      </button>
      {failed ? (
        <>
          <ResendButton
            until={resendUntil(flow)}
            onResend={() => flow.send(email, { resend: true })}
            enabledLabel={t('code.resendNew')}
            className={s.mt12}
          />
          <Separator label={t('code.or')} margin="20px 0 16px" />
          <GoogleButton label={t('signin.google')} onClick={flow.startGoogle} />
        </>
      ) : (
        <>
          <p className={s.codeQ}>{t('code.notArrived')}</p>
          <ResendButton until={resendUntil(flow)} onResend={() => flow.send(email, { resend: true })} />
          <p className={s.lead} style={{ marginTop: 16, fontSize: 14 }}>
            {t('code.linkToo')}
          </p>
        </>
      )}
      <Resent flow={flow} email={email} />
      <TestMailbox />
    </form>
  );
}

function ExpiredStep({ flow, email }: { flow: AuthFlow; email?: string }) {
  const t = useTranslations('auth');
  const to = email ?? flow.letter?.email;
  return (
    <div className="flex flex-col">
      <Badge icon="unlink" tone="grey" className={s.pageTop} />
      <Title afterBadge>{t('expired.title')}</Title>
      <Lead>{to ? t.rich('expired.lead', { email: to, b: Bold }) : t('expired.leadNoEmail')}</Lead>
      {to ? (
        <button type="button" onClick={() => flow.send(to)} className={cn('t2f-focus', s.btn, s.coral, s.mt24)}>
          {t('expired.send')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (to && !flow.email) flow.setEmail(to);
          flow.setStep({ kind: 'form' });
        }}
        className={cn('t2f-focus self-center', s.linkBtn, 'mt-2')}
      >
        {to ? t('expired.change') : t('signin.send')}
      </button>
      <OfflineLine flow={flow} />
      <Separator label={t('expired.or')} margin="12px 0 20px" />
      <GoogleButton label={t('signin.google')} onClick={flow.startGoogle} />
      <Note icon="chat">{t('why.free')}</Note>
    </div>
  );
}

function TooManyStep({ flow, until }: { flow: AuthFlow; until: number }) {
  const t = useTranslations('auth');
  const now = useTick(true);
  const left = until - now;
  const time = formatClock(until);
  const email = flow.letter?.email ?? flow.email;
  return (
    <div className="flex flex-col">
      <Title>{t('signin.title')}</Title>
      <Lead>{t('tooMany.lead')}</Lead>
      <div role="alert" className={s.alertBox}>
        <AuthIcon name="clock" />
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
        <button type="button" onClick={() => flow.submitEmail()} className={cn('t2f-focus', s.btn, s.coral, s.mt16)}>
          {t('signin.send')}
        </button>
      )}
      <Separator label={t('tooMany.meanwhile')} margin="20px 0 16px" />
      <GoogleButton label={t('signin.google')} onClick={flow.startGoogle} />
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
        <AuthIcon name="refresh" />
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

function OtherDeviceStep({ email, validUntil, exitHref }: { email: string; validUntil: number; exitHref: string }) {
  const t = useTranslations('auth.otherDevice');
  return (
    <div className="flex flex-col">
      <Badge icon="check-circle" className={s.pageTop} />
      <Title afterBadge>{t('title')}</Title>
      <Lead>{t.rich('lead', { email, b: Bold })}</Lead>
      <NextLink href={exitHref} className={cn('t2f-focus', s.btn, s.coral, s.mt24)}>
        {t('toLive')}
      </NextLink>
      <section aria-labelledby="auth-od-q" className={s.infoBox}>
        <span aria-hidden="true" className={cn(s.dot, s.grey, s.badgeMd)}>
          <AuthIcon name="devices" />
        </span>
        <span className={s.boxBody}>
          <span id="auth-od-q" className={s.boxTitle}>
            {t('q')}
          </span>
          <span className={s.boxText}>{t('qText', { time: formatClock(validUntil) })}</span>
        </span>
      </section>
      <Note icon="moon">{t('stay')}</Note>
    </div>
  );
}

function WelcomeStep({ email, stream, onExit }: { email: string; stream: boolean; onExit: () => void }) {
  const t = useTranslations('auth.welcome');
  const stamps = useGuestStore((g) => g.stamps.length);
  const nick = useGuestStore((g) => g.nick);
  const flag = useGuestStore((g) => g.flagCode ?? g.detectedFlag ?? 'earth');
  return (
    <div className="flex flex-col">
      <Badge icon="check-circle" className={s.pageTop} />
      <Title afterBadge>{t('title')}</Title>
      <Lead>{t.rich('lead', { email, b: Bold })}</Lead>
      <ul className={s.facts}>
        <li className={s.fact}>
          <span aria-hidden="true" className={cn(s.dot, s.yel, s.badgeSm)}>
            <AuthIcon name="stamp" size={18} />
          </span>
          <span>{t('stamps', { count: stamps })}</span>
        </li>
        <li className={s.fact}>
          <span aria-hidden="true" className={cn(s.dot, s.yel, s.badgeSm)}>
            <AuthIcon name="chat" size={18} />
          </span>
          {nick ? (
            <span>
              {t('nick')}{' '}
              <span className={s.nickPill}>
                <Flag round code={flag} size="xs" decorative />
                {nick}
              </span>
            </span>
          ) : (
            <span>{t('noNick')}</span>
          )}
        </li>
      </ul>
      <button type="button" onClick={onExit} className={cn('t2f-focus', s.btn, s.coral, s.mt24)}>
        {t('back')}
      </button>
      {stream ? <PassRow mt={16} /> : <PassOfferCard welcome className="mt-6" />}
    </div>
  );
}

/** Тестова збірка: замість справжнього листа — код і посилання просто тут. */
function TestMailbox() {
  const t = useTranslations('auth.test');
  const letter = useAuthStore((a) => a.letter);
  const expire = useAuthStore((a) => a.expireLetter);
  const now = useTick(IS_TEST_BUILD && !!letter);
  if (!IS_TEST_BUILD || !letter) return null;
  const expired = letter.used || now - letter.sentAt > LETTER_TTL_MS;
  return (
    <aside aria-label={t('title')} className={s.mailbox} data-test-mailbox="">
      <span className={s.mailboxTitle}>{t('title')}</span>
      <span>{t('letter', { email: letter.email })}</span>
      <span>
        {t('code')}: <span className={s.mailboxCode} data-test-code="">{letter.code}</span>
        {expired ? ' ·  ✕' : ''}
      </span>
      <span className={s.pair}>
        <a href={`/login/?link=${letter.token}`} target="_blank" rel="noopener" className={cn('t2f-focus', s.btn, s.ghost)} data-test-link="">
          {t('open')}
        </a>
        <button type="button" onClick={expire} className={cn('t2f-focus', s.btn, s.ghost)}>
          {t('expire')}
        </button>
      </span>
      <span className={s.hint}>{t('note')}</span>
    </aside>
  );
}
