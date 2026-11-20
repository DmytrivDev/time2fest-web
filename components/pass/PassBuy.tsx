'use client';

/**
 * Оформлення Новорічного пасу — тіло картки на сторінці (`S-PASS · …`) і у вікні під трансляцією (`O-PASS-BUY · …`).
 * Стани (дошки v100, правки v102): гість (Google або email; помилка email; «На цю адресу пас уже оформлено» → код для входу),
 * увійшов — без email («Оформлюємо на акаунт … · Не ти?»), «Відкриваємо оплату…» (і поки сервіс приймає замовлення),
 * «Не вдалося відкрити оплату» (мережа, оплату вимкнено), «Чекаємо підтвердження оплати», «Оплата не пройшла», «Час на
 * оплату минув», «Пас активний — свято на повну!», «Твій пас уже діє». Гість, що оплатив без входу, має пас на цьому
 * пристрої; «Увійти кодом» переносить його в акаунт (рішення власника 2026-11-13) — лише раз, в перший акаунт на пристрої;
 * увійшли тут в інший акаунт — пас працює на пристрої, і так і сказано (рішення 2026-11-14). Логіку тримає `stores/pass`.
 * Кнопка після оплати: на сторінці — «Повернутися на головну»; у вікні (воно поруч із трансляцією) — «Дивитися далі»:
 * закриває вікно, і права колонка стає такою, як була (чат чи нічого) — правка власника 2026-10-30.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bold, BusyButton, EmailField, ErrorLine, GoogleButton, Separator, authStyles as a } from '@/components/auth/AuthParts';
import { Icon } from '@/components/primitives/Icon';
import { useHydrated } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { ToastGift } from '@/components/toast/ToastGift';
import { useCanToast } from '@/components/toast/useToastSeason';
import { formatUsd } from '@/lib/offers/format';
import { useSitePrices } from '@/lib/api/hooks/site';
import { authCodeError } from '@/lib/api/contracts/auth';
import { authActions, useHasPass, useProfile, useSession } from '@/lib/api/hooks/auth';
import { formatClock } from '@/lib/i18n/time';
import { usePassStore } from '@/stores/pass';
import s from './pass.module.css';

export type PassBuyVariant = 'page' | 'stream';

export type PassView = 'guest' | 'signed' | 'opening' | 'pending' | 'failed' | 'startFailed' | 'expired' | 'success' | 'active';

/** Що показати зараз: з пасом — «уже діє» (крім щойно оплаченого), далі — етап оплати, далі — хто людина. */
export function usePassView(): PassView {
  const hydrated = useHydrated();
  const phase = usePassStore((st) => st.phase);
  const hasPass = useHasPass();
  const user = (useSession().session?.user ?? null);
  if (!hydrated) return 'guest';
  if (phase === 'success') return 'success';
  if (hasPass) return 'active';
  if (phase === 'opening' || phase === 'pending' || phase === 'failed' || phase === 'startFailed' || phase === 'expired') return phase;
  return user ? 'signed' : 'guest';
}

export interface PassBuyProps {
  variant: PassBuyVariant;
  /** «Вже маєш акаунт? Увійти»: сторінка — `/login/`, вікно — вхід вікном. */
  onSignIn: () => void;
  /** «Надіслати код» (адреса з пасом, чи пас на пристрої): код уже надіслано — показати крок «Введи код». */
  onCodeSent: () => void;
  /** Вікно: «Дивитися далі» — закрити вікно. */
  onDone?: () => void;
}

/** На сторінці картка тримає крок 6 px між рядками (як на дошці), у вікні — без нього. */
const col = (variant: PassBuyVariant) => cn(s.body, variant === 'page' ? 'flex flex-col gap-1.5' : 'flex flex-col');

function Head({ signed }: { signed: boolean }) {
  const price = formatUsd(useSitePrices().pass);
  const t = useTranslations('pass.buy');
  return (
    <>
      <div className={s.head}>
        <span className={s.eyebrow}>
          <Icon name="ticket" size={16} />
          {t('eyebrow')}
        </span>
        <span className={s.headPrice}>{price}</span>
      </div>
      <h3 className={s.h3}>{signed ? t('titleSigned') : t('titleGuest')}</h3>
    </>
  );
}

/** «Надіслати код» на пошту: «Надсилаємо…», помилка рядком; надіслано (чи код щойно йшов) — крок «Введи код». */
function useSendCode(email: string, onSent: () => void) {
  const t = useTranslations('auth.code');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const now = Date.now();
    const res = await authActions.requestCode(email, 'signin');
    setBusy(false);
    if (res.ok) return onSent();
    const kind = authCodeError(res.error);
    if (kind === 'cooldown') return onSent();
    if (kind === 'rate-limited') setError(t.rich('sendFailedLimited', { time: formatClock(now + (res.error.retryAfterMs ?? 0)), b: Bold }));
    else if (kind === 'unavailable') setError(t('sendFailedUnavailable'));
    else setError(t('sendFailedNetwork'));
  };
  return { busy, error, send };
}

/**
 * Пас на цьому пристрої (гість оплатив без входу чи пас за тост $10): де він живе й «Увійти кодом» (код на пошту з
 * оплати). Пас іде до першого акаунта, в який ввійдуть на пристрої (рішення власника 2026-11-15) — і буде на всіх пристроях.
 */
export function DeviceSignIn({ email, onCodeSent }: { email: string; onCodeSent: () => void }) {
  const t = useTranslations('pass.buy');
  return (
    <div className={s.deviceNote} data-row="device-pass" data-device-pass="guest">
      <p className={cn(s.note, s.noteSm)} style={{ marginTop: 0 }}>
        <Icon name="user" size={18} />
        <span>{t('deviceNote')}</span>
      </p>
      <SendCodeButton email={email} onSent={onCodeSent} />
    </div>
  );
}

/** «Увійти кодом» на пошту з оплати («Надсилаємо…», помилка рядком) — пас на пристрої (вікно пасу, подарунок тосту). */
export function SendCodeButton({ email, onSent }: { email: string; onSent: () => void }) {
  const t = useTranslations('pass.buy');
  const code = useSendCode(email, onSent);
  return (
    <>
      <BusyButton type="button" busy={code.busy} busyLabel={t('sending')} tone="ghost" onClick={code.send} action="device-sign-in">
        <Icon name="envelope" size={18} />
        {t('deviceSignIn')}
      </BusyButton>
      {code.error ? <ErrorLine mt={4}>{code.error}</ErrorLine> : null}
    </>
  );
}

/** Дрібний текст під кнопкою оплати (v102): по лівому краю, замок на рівні першого рядка; згода — другим абзацом поруч. */
function LockLine({ stream, consent }: { stream: boolean; consent?: boolean }) {
  const t = useTranslations('pass.buy');
  return (
    <div className={s.lockLine} data-row="fine-print">
      <span aria-hidden="true" className={s.lockIcon}>
        <Icon name="lock-tall" size={14} />
      </span>
      <p>{stream ? t('payNoteStream') : t('payNote')}</p>
      {consent ? (
        <p className={s.consent}>
          {t.rich('age', {
            terms: (c) => (
              <a href="/rules/" target="_blank" rel="noopener" className="t2f-focus">
                {c}
              </a>
            ),
            privacy: (c) => (
              <NextLink href="/privacy/" className="t2f-focus">
                {c}
              </NextLink>
            ),
          })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Інші шляхи («Вже маєш акаунт? Увійти», «Скажи тост за $10 · …і Новорічний пас у подарунок» — дошка `Pass-5-New`,
 * 2026-11-12) — окремою групою під лінією; у сайдбарі десктопа притиснуті донизу.
 */
function Alternatives({ children }: { children: ReactNode }) {
  return (
    <div className={s.alt} data-row="alternatives">
      <hr aria-hidden="true" className={s.altLine} />
      {children}
    </div>
  );
}

function Spinner({ size = 20, big }: { size?: number; big?: boolean }) {
  return big ? (
    <svg className={s.spinner} width="3rem" height="3rem" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="20" stroke="var(--color-border)" strokeWidth="4" />
      <path d="M24 4a20 20 0 0 1 20 20" stroke="var(--color-highlight)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  ) : (
    <svg className={s.spinner} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke="rgba(255,255,255,0.3)" strokeWidth="5" />
      <path d="M24 5a19 19 0 0 1 19 19" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** «Оформлюємо на акаунт …» — той, хто увійшов, email не вводить. */
function AccountRow({ email, note, mt = 16, notYou }: { email: string; note: string; mt?: number; notYou?: () => void }) {
  const t = useTranslations('pass.buy');
  const nick = useProfile()?.nick ?? undefined;
  return (
    <>
      <div className={s.account} style={{ marginTop: `${mt / 16}rem` }} data-row="account">
        <span aria-hidden="true" className={s.avatar}>
          {(nick?.trim() || email).charAt(0).toUpperCase()}
        </span>
        <span className={s.accountText}>
          <span className={s.accountLabel}>{t('accountFor')}</span>
          <span className={s.emailLine}>
            <span className={s.accountEmail} title={email}>
              {email}
            </span>
            {/* «Не ти?» — у рядку з поштою, по центру з нею (власник 2026-11-08). */}
            {notYou ? (
              <button type="button" className={cn('t2f-focus', s.notYou)} onClick={notYou}>
                {t('notYou')}
              </button>
            ) : null}
          </span>
        </span>
      </div>
      <p className={a.hint}>{note}</p>
    </>
  );
}

function PayButton({ busy, disabled, mt = 16, label }: { busy: boolean; disabled?: boolean; mt?: number; label?: string }) {
  const price = formatUsd(useSitePrices().pass);
  const t = useTranslations('pass.buy');
  if (disabled) {
    return (
      <button type="button" aria-disabled="true" className={cn('t2f-focus', a.btn, a.disabled)} style={{ marginTop: `${mt / 16}rem` }} onClick={(e) => e.preventDefault()}>
        {label ?? t('pay', { price })}
      </button>
    );
  }
  return (
    <button
      type="submit"
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={cn('t2f-focus', a.btn, a.coral)}
      style={{ marginTop: `${mt / 16}rem`, ...(busy ? { background: '#A8333A', color: 'rgba(255,255,255,0.85)' } : null) }}
      data-action="pay"
    >
      {busy ? <Spinner /> : null}
      {busy ? t('opening') : (label ?? t('pay', { price }))}
    </button>
  );
}

/** Рядок службових посилань: «Допомога» — `/help/`, умови й повернення — `/payments/` (сторінки є з 2026-11-07). */
function LinkRow({ items, mt = 8 }: { items: { label: string; href: string }[]; mt?: number }) {
  return (
    <div className={s.linkRow} style={{ marginTop: `${mt / 16}rem` }}>
      {items.map(({ label, href }) => (
        <NextLink key={label} href={href} className="t2f-focus">
          {label}
        </NextLink>
      ))}
    </div>
  );
}

/** Гість: Google або email — як вхід; акаунт створиться разом з оплатою. */
function GuestForm({ variant, onSignIn, onCodeSent }: PassBuyProps) {
  const t = useTranslations('pass.buy');
  const stream = variant === 'stream';
  const flow = usePassStore();
  const busy = flow.phase === 'opening' || flow.starting;
  const google = flow.phase === 'google';
  const issue = flow.emailIssue;
  const emailError =
    issue === 'empty' ? t('emailEmpty') : issue === 'invalid' ? (/@[^.]*$/.test(flow.email.trim()) ? t('emailNoDomain') : t('emailInvalid')) : null;
  const code = useSendCode(flow.email, onCodeSent);
  return (
    <form
      noValidate
      className={col(variant)}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || google) return;
        flow.submitEmail();
      }}
    >
      {!stream ? <Head signed={false} /> : null}
      <GoogleButton label={google ? t('googleWait') : t('google')} onClick={() => !google && !busy && flow.startGoogle()} className={stream ? a.mt12 : a.mt20} />
      {flow.googleFailed ? <ErrorLine mt={8}>{t('googleFailed')}</ErrorLine> : null}
      <Separator label={t('or')} margin={stream ? '14px 0' : '16px 0'} />
      <EmailField value={flow.email} onChange={flow.setEmail} hint={stream ? t('emailHintStream') : t('emailHint')} error={emailError} readOnly={busy} />
      {flow.paidEmail ? (
        <div role="alert" className={s.paid} data-row="paid-email">
          <span className={s.paidHead}>
            <Icon name="check-circle" size={20} />
            <span className={s.paidBody}>
              <span className={s.paidTitle}>{t('paidTitle')}</span>
              <span className={s.paidText}>{t('paidText')}</span>
            </span>
          </span>
          <span className={s.paidHint}>{t('paidHint')}</span>
          <BusyButton type="button" busy={code.busy} busyLabel={t('sending')} tone="coral" className={s.paidBtn} onClick={code.send} action="send-code">
            <Icon name="envelope" size={18} />
            {t('paidSend')}
          </BusyButton>
          {code.error ? <ErrorLine mt={8}>{code.error}</ErrorLine> : null}
        </div>
      ) : null}
      <PayButton busy={busy} disabled={flow.paidEmail} mt={flow.paidEmail ? 12 : stream ? 12 : 16} />
      <LockLine stream={stream} consent />
      <Alternatives>
        <p className={a.switchRow} style={{ marginTop: '0.25rem' }}>
          {t('haveAccount')}
          <button type="button" onClick={onSignIn} className="t2f-focus">
            {t('signIn')}
          </button>
        </p>
        {!stream ? <ToastGift variant="page" className={s.toastGiftPage} /> : null}
      </Alternatives>
    </form>
  );
}

/** Той, хто увійшов: акаунт замість email. */
function SignedForm({ variant }: { variant: PassBuyVariant }) {
  const t = useTranslations('pass.buy');
  const stream = variant === 'stream';
  const email = (useSession().session?.user?.email ?? '');
  const flow = usePassStore();
  const canToast = useCanToast();
  const busy = flow.phase === 'opening' || flow.starting;
  return (
    <form
      noValidate
      className={col(variant)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) flow.pay();
      }}
    >
      {!stream ? <Head signed /> : null}
      <AccountRow
        email={email}
        note={t('accountNote')}
        mt={stream ? 14 : 20}
        notYou={() => {
          void authActions.signOut();
          flow.reset();
        }}
      />
      <PayButton busy={busy} mt={stream ? 14 : 16} />
      {busy ? (
        <p role="status" className={cn(a.hint, a.center)} style={{ marginTop: '0.5rem' }}>
          {t('openingNote')}
        </p>
      ) : (
        <LockLine stream={stream} />
      )}
      {/* Інших шляхів, крім тосту за $10, тут немає: до й після свята (тосту немає) — і блоку немає. */}
      {!stream && canToast ? (
        <Alternatives>
          <ToastGift variant="page" className={s.toastGiftPage} />
        </Alternatives>
      ) : null}
    </form>
  );
}

function Pending({ variant, onDone }: { variant: PassBuyVariant; onDone?: () => void }) {
  const t = useTranslations('pass.buy');
  const email = useSession().session?.user?.email ?? usePassStore.getState().email.trim();
  return (
    <div className={col(variant)} data-phase="pending">
      <div role="status" aria-live="polite" className={s.status}>
        <Spinner big />
        <h3 className={s.statusTitle}>{t('pendingTitle')}</h3>
        <p className={s.statusText}>{t('pendingText')}</p>
      </div>
      <p className={s.note}>
        <Icon name="envelope" size={18} />
        <span>{t.rich('pendingNote', { email, b: Bold })}</span>
      </p>
      <DoneButton variant={variant} onDone={onDone} ghost mt={16} />
      <LinkRow items={[{ label: t('payHelp'), href: '/help/' }]} mt={4} />
    </div>
  );
}

function Failed() {
  const price = formatUsd(useSitePrices().pass);
  const t = useTranslations('pass.buy');
  const user = (useSession().session?.user ?? null);
  const flow = usePassStore();
  const email = user?.email ?? flow.email.trim();
  return (
    <form
      noValidate
      className={cn(s.body, 'flex flex-col gap-1.5')}
      data-phase="failed"
      onSubmit={(e) => {
        e.preventDefault();
        flow.pay();
      }}
    >
      <span aria-hidden="true" className={s.failBadge}>
        <Icon name="alert-bold" size={24} />
      </span>
      <h3 role="alert" className={s.failTitle}>
        {t('failedTitle')}
      </h3>
      <p className={s.text}>{t('failedText')}</p>
      <AccountRow email={email} note={t('failedAccount')} />
      <PayButton busy={false} label={t('retry', { price })} />
      <LinkRow items={[{ label: t('payHelp'), href: '/help/' }, { label: t('refunds'), href: '/payments/' }]} mt={4} />
    </form>
  );
}

/** Старт оплати не вдався (мережа, оплату вимкнено): гроші не списано, «Спробувати ще». */
function StartFailed() {
  const price = formatUsd(useSitePrices().pass);
  const t = useTranslations('pass.buy');
  const flow = usePassStore();
  return (
    <form
      noValidate
      className={cn(s.body, 'flex flex-col gap-1.5')}
      data-phase="start-failed"
      onSubmit={(e) => {
        e.preventDefault();
        flow.pay();
      }}
    >
      <span aria-hidden="true" className={s.failBadge}>
        <Icon name="alert-bold" size={24} />
      </span>
      <h3 role="alert" className={s.failTitle}>
        {t('startFailedTitle')}
      </h3>
      <p className={s.text}>{flow.startError === 'unavailable' ? t('startUnavailableText') : t('startFailedText')}</p>
      <PayButton busy={flow.starting || flow.phase === 'opening'} label={t('retry', { price })} />
      <LinkRow items={[{ label: t('payHelp'), href: '/help/' }]} mt={4} />
    </form>
  );
}

/** Замовлення закрилось неоплаченим (PayPro: час минув): «Оформити заново» — до форми з тим самим введеним. */
function Expired() {
  const t = useTranslations('pass.buy');
  return (
    <div className={cn(s.body, 'flex flex-col gap-1.5')} data-phase="expired">
      <span aria-hidden="true" className={s.failBadge}>
        <Icon name="clock-wide" size={24} />
      </span>
      <h3 role="alert" className={s.failTitle}>
        {t('expiredTitle')}
      </h3>
      <p className={s.text}>{t('expiredText')}</p>
      <button type="button" className={cn('t2f-focus', a.btn, a.coral)} style={{ marginTop: '1rem' }} onClick={() => usePassStore.setState({ phase: 'form' })} data-action="again">
        {t('again')}
      </button>
      <LinkRow items={[{ label: t('payHelp'), href: '/help/' }]} mt={4} />
    </div>
  );
}

/** Сторінка: «Повернутися на головну»; вікно: «Дивитися далі» (закриває вікно). */
function DoneButton({ variant, onDone, ghost, mt, homeLabel }: { variant: PassBuyVariant; onDone?: () => void; ghost?: boolean; mt: number; homeLabel?: string }) {
  const t = useTranslations('pass.buy');
  const cls = cn('t2f-focus', a.btn, ghost ? a.ghost : a.coral);
  if (variant === 'stream') {
    return (
      <button type="button" className={cls} style={{ marginTop: `${mt / 16}rem` }} onClick={onDone} data-action="done">
        {t('watch')}
      </button>
    );
  }
  return (
    <NextLink href="/" className={cls} style={{ marginTop: `${mt / 16}rem` }} data-action="done">
      {homeLabel ?? t('home')}
    </NextLink>
  );
}

/** Вікно: «Детальніше про пас» під «Дивитися далі» — сторінка пасу (вікно закривається). */
function MoreButton({ onDone }: { onDone?: () => void }) {
  const t = useTranslations('pass.buy');
  return (
    <NextLink href="/pass/" className={cn('t2f-focus', a.btn, a.ghost)} style={{ marginTop: '0.5rem' }} onClick={() => onDone?.()} data-action="more">
      {t('more')}
    </NextLink>
  );
}

const CONFETTI = (
  <svg aria-hidden="true" className={s.confetti} viewBox="0 0 400 60" preserveAspectRatio="xMidYMid slice">
    <rect x="250" y="16" width="5" height="9" rx="1" fill="#F94A51" transform="rotate(25 252 20)" />
    <rect x="300" y="8" width="4" height="8" rx="1" fill="#FCE286" transform="rotate(-30 302 12)" />
    <circle cx="338" cy="30" r="2.2" fill="#ECECEF" />
    <rect x="368" y="20" width="5" height="8" rx="1" fill="#FCE286" transform="rotate(60 370 24)" />
    <path d="M220 12 l2 -6 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 Z" fill="#FCE286" />
  </svg>
);

function Success({ variant, onDone, onCodeSent }: { variant: PassBuyVariant; onDone?: () => void; onCodeSent: () => void }) {
  const t = useTranslations('pass.buy');
  const session = useSession().session;
  // Пас лише на цьому пристрої (гість) — пояснення й «Увійти кодом» замість «Ти вже увійшов».
  const devicePass = session?.passOn === 'device' ? session.devicePass : null;
  const email = session?.user?.email ?? devicePass?.email ?? '';
  const profile = useProfile();
  const nick = profile?.nick ?? undefined;
  const flagCode = profile?.flagCode ?? profile?.detectedFlag ?? 'earth';
  // Ім’я на квитку — лише нік (профіль: у гостя — чат-нік); з пошти ім’я не вигадуємо.
  const name = nick?.trim() ?? '';
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const works: { icon: 'ticket' | 'calendar-time' | 'filter'; key: string }[] = [
    { icon: 'ticket', key: 'worksBadge' },
    { icon: 'calendar-time', key: 'worksSchedule' },
    { icon: 'filter', key: 'worksQuiet' },
  ];
  return (
    <div className={col(variant)} data-phase="success">
      <div className={s.success}>
        {CONFETTI}
        <span role="status" className={s.successStatus}>
          <Icon name="tick" size={16} />
          {t('successStatus')}
        </span>
        <h3 ref={ref} tabIndex={-1} className={cn(s.successTitle, 'focus:outline-none')}>
          {t('successTitle')}
        </h3>
      </div>
      <div role="img" aria-label={name ? t('ticketLabel', { name }) : t('ticketLabelNoName')} className={s.ticket}>
        <div className={s.ticketMain}>
          <span className={s.ticketBrand}>{t('ticketBrand')}</span>
          <span className={s.ticketName}>{t('ticketName')}</span>
          {name && (
            <span className={s.ticketWho}>
              <Flag code={flagCode} size="xs" decorative />
              <span>{name}</span>
            </span>
          )}
        </div>
        <div aria-hidden="true" className={s.ticketStub}>
          <span className={s.ticketStar}>★</span>
          <span className={s.ticketSeason}>{t('ticketSeason')}</span>
          <span className={s.ticketYear}>2026/27</span>
        </div>
      </div>
      <ul className={s.works}>
        {works.map((w) => (
          <li key={w.key}>
            <span aria-hidden="true" className={cn(s.dot, s.dot28)}>
              <Icon name={w.icon} size={15} />
            </span>
            {t(w.key)}
          </li>
        ))}
      </ul>
      <DoneButton variant={variant} onDone={onDone} mt={18} />
      {variant === 'stream' ? <MoreButton onDone={onDone} /> : null}
      {devicePass ? (
        <DeviceSignIn email={devicePass.email} onCodeSent={onCodeSent} />
      ) : (
        <p className={cn(s.note, s.noteSm)} style={{ marginTop: '0.875rem' }}>
          <Icon name="user" size={18} />
          <span>{t.rich('signedAs', { email, b: Bold })}</span>
        </p>
      )}
      <LinkRow items={[{ label: t('terms'), href: '/payments/' }]} mt={2} />
    </div>
  );
}

function Active({ variant, onDone, onCodeSent }: { variant: PassBuyVariant; onDone?: () => void; onCodeSent: () => void }) {
  const t = useTranslations('pass.buy');
  const p = useTranslations('pass.page');
  const session = useSession().session;
  const user = session?.user ?? null;
  // Пас живе лише на цьому пристрої (гість): до першого акаунта, в який ввійдуть тут (рішення 2026-11-15).
  const devicePass = session?.passOn === 'device' ? session.devicePass : null;
  const since = session?.passSince ?? undefined;
  const date = since !== undefined ? new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(since) : null;
  return (
    <div className={col(variant)} data-phase="active">
      <div className={s.activeHead}>
        {/* Без іконки квитка: вона вже в заголовку вікна й у герої сторінки (v102). */}
        <span className={s.eyebrow}>{t('activeEyebrow')}</span>
        <span className={s.activeBadge}>
          <Icon name="tick" size={14} />
          {p('active')}
        </span>
      </div>
      <h3 className={s.failTitle} style={{ marginTop: '0.875rem' }}>
        {t('activeTitle')}
      </h3>
      <p className={s.text}>
        {devicePass && date
          ? t.rich('activeTextGuestDevice', { date, email: devicePass.email, b: Bold })
          : user && date
            ? t.rich('activeText', { date, email: user.email, b: Bold })
            : t('activeTextDevice')}
      </p>
      <DoneButton variant={variant} onDone={onDone} mt={20} homeLabel={t('toHome')} />
      {variant === 'page' ? (
        <NextLink href="/passport/" className={cn('t2f-focus', a.btn, a.ghost)} style={{ marginTop: '0.5rem' }}>
          {t('passport')}
        </NextLink>
      ) : (
        <MoreButton onDone={onDone} />
      )}
      {devicePass ? <DeviceSignIn email={devicePass.email} onCodeSent={onCodeSent} /> : null}
      <LinkRow items={[{ label: t('refunds'), href: '/payments/' }, { label: t('help'), href: '/help/' }]} mt={4} />
    </div>
  );
}

/** Тіло картки оформлення за поточним станом. */
export function PassBuy(props: PassBuyProps) {
  const view = usePassView();
  const signedIn = (useSession().session?.user ?? null) !== null;
  const { variant, onDone, onCodeSent } = props;
  switch (view) {
    case 'success':
      return <Success variant={variant} onDone={onDone} onCodeSent={onCodeSent} />;
    case 'active':
      return <Active variant={variant} onDone={onDone} onCodeSent={onCodeSent} />;
    case 'startFailed':
      return <StartFailed />;
    case 'expired':
      return <Expired />;
    case 'pending':
      return <Pending variant={variant} onDone={onDone} />;
    case 'failed':
      return <Failed />;
    case 'signed':
      return <SignedForm variant={variant} />;
    case 'opening':
      return signedIn ? <SignedForm variant={variant} /> : <GuestForm {...props} />;
    default:
      return <GuestForm {...props} />;
  }
}
