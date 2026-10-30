'use client';

/**
 * Оформлення Новорічного пасу — тіло картки на сторінці (`S-PASS · …`) і у вікні під трансляцією (`O-PASS-BUY · …`).
 * Стани (дошки v100): гість (Google або email; помилка email; «На цю адресу пас уже оформлено»), увійшов — без email
 * («Оформлюємо на акаунт … · Не ти?»), «Відкриваємо оплату…», «Чекаємо підтвердження оплати», «Оплата не пройшла»,
 * «Пас активний — свято на повну!», «Твій пас уже діє». Логіку тримає `stores/pass`.
 * Кнопка після оплати: на сторінці — «Повернутися на головну»; у вікні (воно поруч із трансляцією) — «Дивитися далі»:
 * закриває вікно, і права колонка стає такою, як була (чат чи нічого) — правка власника 2026-10-30.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useEffect, useRef } from 'react';
import { Bold, EmailField, ErrorLine, GoogleButton, Separator, authStyles as a } from '@/components/auth/AuthParts';
import { AuthIcon } from '@/components/auth/icons';
import { useHydrated } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { useAuthStore } from '@/stores/auth';
import { useBoughtPass } from '@/stores/firstRow';
import { useGuestStore } from '@/stores/guest';
import { usePassStore } from '@/stores/pass';
import s from './pass.module.css';

export type PassBuyVariant = 'page' | 'stream';

export type PassView = 'guest' | 'signed' | 'opening' | 'pending' | 'failed' | 'success' | 'active';

/** Що показати зараз: з пасом — «уже діє» (крім щойно оплаченого), далі — етап оплати, далі — хто людина. */
export function usePassView(): PassView {
  const hydrated = useHydrated();
  const phase = usePassStore((st) => st.phase);
  const hasPass = useGuestStore((st) => st.hasPass);
  const user = useAuthStore((st) => st.user);
  if (!hydrated) return 'guest';
  if (phase === 'success') return 'success';
  if (hasPass) return 'active';
  if (phase === 'opening' || phase === 'pending' || phase === 'failed') return phase;
  return user ? 'signed' : 'guest';
}

export interface PassBuyProps {
  variant: PassBuyVariant;
  /** «Вже маєш акаунт? Увійти»: сторінка — `/login/`, вікно — вхід вікном. */
  onSignIn: () => void;
  /** «Надіслати посилання для входу» (адреса з пасом): лист уже надіслано — показати крок «Лист надіслано». */
  onLetterSent: () => void;
  /** Вікно: «Дивитися далі» — закрити вікно. */
  onDone?: () => void;
}

const PRICE = formatUsd(PASS_PRICE);
/** На сторінці картка тримає крок 6 px між рядками (як на дошці), у вікні — без нього. */
const col = (variant: PassBuyVariant) => (variant === 'page' ? 'flex flex-col gap-1.5' : 'flex flex-col');

function Head({ signed }: { signed: boolean }) {
  const t = useTranslations('pass.buy');
  return (
    <>
      <div className={s.head}>
        <span className={s.eyebrow}>
          <AuthIcon name="ticket" size={16} />
          {t('eyebrow')}
        </span>
        <span className={s.headPrice}>{PRICE}</span>
      </div>
      <h3 className={s.h3}>{signed ? t('titleSigned') : t('titleGuest')}</h3>
    </>
  );
}

function LockLine({ stream }: { stream: boolean }) {
  const t = useTranslations('pass.buy');
  return (
    <p className={s.lockLine}>
      <AuthIcon name="lock" size={14} />
      {stream ? t('payNoteStream') : t('payNote')}
    </p>
  );
}

function Spinner({ size = 20, big }: { size?: number; big?: boolean }) {
  return big ? (
    <svg className={s.spinner} width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
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
  const nick = useGuestStore((st) => st.nick);
  return (
    <>
      <div className={s.account} style={{ marginTop: mt }} data-row="account">
        <span aria-hidden="true" className={s.avatar}>
          {(nick?.trim() || email).charAt(0).toUpperCase()}
        </span>
        <span className={s.accountText}>
          <span className={s.accountLabel}>{t('accountFor')}</span>
          <span className={s.accountEmail}>{email}</span>
        </span>
        {notYou ? (
          <button type="button" className={cn('t2f-focus', s.notYou)} onClick={notYou}>
            {t('notYou')}
          </button>
        ) : null}
      </div>
      <p className={a.hint}>{note}</p>
    </>
  );
}

function PayButton({ busy, disabled, mt = 16, label }: { busy: boolean; disabled?: boolean; mt?: number; label?: string }) {
  const t = useTranslations('pass.buy');
  if (disabled) {
    return (
      <button type="button" aria-disabled="true" className={cn('t2f-focus', a.btn, a.disabled)} style={{ marginTop: mt }} onClick={(e) => e.preventDefault()}>
        {label ?? t('pay', { price: PRICE })}
      </button>
    );
  }
  return (
    <button
      type="submit"
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      className={cn('t2f-focus', a.btn, a.coral)}
      style={{ marginTop: mt, ...(busy ? { background: '#A8333A', color: 'rgba(255,255,255,0.85)' } : null) }}
      data-action="pay"
    >
      {busy ? <Spinner /> : null}
      {busy ? t('opening') : (label ?? t('pay', { price: PRICE }))}
    </button>
  );
}

function FirstRowGift({ mt = 4 }: { mt?: number }) {
  const t = useTranslations('pass.buy');
  return (
    <NextLink href="/" className={cn('t2f-focus', s.giftLink)} style={{ marginTop: mt }}>
      <AuthIcon name="seat" size={16} />
      {t('firstRow')}
    </NextLink>
  );
}

function LinkRow({ items, mt = 8 }: { items: string[]; mt?: number }) {
  return (
    <div className={s.linkRow} style={{ marginTop: mt }}>
      {items.map((label) => (
        // Сторінок допомоги й умов ще немає — як у футері, інертні посилання.
        <NextLink key={label} href="#" className="t2f-focus">
          {label}
        </NextLink>
      ))}
    </div>
  );
}

/** Гість: Google або email — як вхід; акаунт створиться разом з оплатою. */
function GuestForm({ variant, onSignIn, onLetterSent }: PassBuyProps) {
  const t = useTranslations('pass.buy');
  const stream = variant === 'stream';
  const flow = usePassStore();
  const busy = flow.phase === 'opening';
  const google = flow.phase === 'google';
  const issue = flow.emailIssue;
  const emailError =
    issue === 'empty' ? t('emailEmpty') : issue === 'invalid' ? (/@[^.]*$/.test(flow.email.trim()) ? t('emailNoDomain') : t('emailInvalid')) : null;
  const sendLink = () => {
    const res = useAuthStore.getState().sendLetter(flow.email, 'signin', Date.now());
    // Лист нещодавно вже йшов — той самий крок «Лист надіслано» з відліком до нового.
    if (res.ok || res.reason === 'wait') onLetterSent();
  };
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
            <AuthIcon name="check-circle" />
            <span className={s.paidBody}>
              <span className={s.paidTitle}>{t('paidTitle')}</span>
              <span className={s.paidText}>{t('paidText')}</span>
            </span>
          </span>
          <button type="button" className={cn('t2f-focus', a.btn, a.coral)} onClick={sendLink} data-action="send-link">
            {t('paidSend')}
          </button>
        </div>
      ) : null}
      <PayButton busy={busy} disabled={flow.paidEmail} mt={flow.paidEmail ? 12 : stream ? 12 : 16} />
      <LockLine stream={stream} />
      <p className={a.switchRow} style={{ marginTop: stream ? 0 : 4 }}>
        {t('haveAccount')}
        <button type="button" onClick={onSignIn} className="t2f-focus">
          {t('signIn')}
        </button>
      </p>
      <p className={a.age} style={{ marginTop: stream ? 2 : 4 }}>
        {t.rich('age', {
          terms: (c) => (
            <a href="/rules/" target="_blank" rel="noopener" className="t2f-focus">
              {c}
            </a>
          ),
          // Сторінки політики ще немає — як у футері, інертне посилання.
          privacy: (c) => (
            <NextLink href="#" className="t2f-focus">
              {c}
            </NextLink>
          ),
        })}
      </p>
      {!stream ? <FirstRowGift /> : null}
    </form>
  );
}

/** Той, хто увійшов: акаунт замість email. */
function SignedForm({ variant }: { variant: PassBuyVariant }) {
  const t = useTranslations('pass.buy');
  const stream = variant === 'stream';
  const email = useAuthStore((st) => st.user?.email ?? '');
  const flow = usePassStore();
  const busy = flow.phase === 'opening';
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
          useAuthStore.getState().signOut();
          flow.reset();
        }}
      />
      <PayButton busy={busy} mt={stream ? 14 : 16} />
      {busy ? (
        <p role="status" className={cn(a.hint, a.center)} style={{ marginTop: 8 }}>
          {t('openingNote')}
        </p>
      ) : (
        <LockLine stream={stream} />
      )}
      {!stream ? <FirstRowGift /> : null}
    </form>
  );
}

function Pending({ variant, onDone }: { variant: PassBuyVariant; onDone?: () => void }) {
  const t = useTranslations('pass.buy');
  const email = useAuthStore((st) => st.user?.email) ?? usePassStore.getState().email.trim();
  return (
    <div className={col(variant)} data-phase="pending">
      <div role="status" aria-live="polite" className={s.status}>
        <Spinner big />
        <h3 className={s.statusTitle}>{t('pendingTitle')}</h3>
        <p className={s.statusText}>{t('pendingText')}</p>
      </div>
      <p className={s.note}>
        <AuthIcon name="mail" size={18} />
        <span>{t.rich('pendingNote', { email, b: Bold })}</span>
      </p>
      <DoneButton variant={variant} onDone={onDone} ghost mt={16} />
      <LinkRow items={[t('payHelp')]} mt={4} />
    </div>
  );
}

function Failed() {
  const t = useTranslations('pass.buy');
  const user = useAuthStore((st) => st.user);
  const flow = usePassStore();
  const email = user?.email ?? flow.email.trim();
  return (
    <form
      noValidate
      className="flex flex-col gap-1.5"
      data-phase="failed"
      onSubmit={(e) => {
        e.preventDefault();
        flow.pay();
      }}
    >
      <span aria-hidden="true" className={s.failBadge}>
        <AuthIcon name="alert" size={24} />
      </span>
      <h3 role="alert" className={s.failTitle}>
        {t('failedTitle')}
      </h3>
      <p className={s.text}>{t('failedText')}</p>
      <AccountRow email={email} note={t('failedAccount')} />
      <PayButton busy={false} label={t('retry', { price: PRICE })} />
      <LinkRow items={[t('payHelp'), t('refunds')]} mt={4} />
    </form>
  );
}

/** Сторінка: «Повернутися на головну»; вікно: «Дивитися далі» (закриває вікно). */
function DoneButton({ variant, onDone, ghost, mt, homeLabel }: { variant: PassBuyVariant; onDone?: () => void; ghost?: boolean; mt: number; homeLabel?: string }) {
  const t = useTranslations('pass.buy');
  const cls = cn('t2f-focus', a.btn, ghost ? a.ghost : a.coral);
  if (variant === 'stream') {
    return (
      <button type="button" className={cls} style={{ marginTop: mt }} onClick={onDone} data-action="done">
        {t('watch')}
      </button>
    );
  }
  return (
    <NextLink href="/" className={cls} style={{ marginTop: mt }} data-action="done">
      {homeLabel ?? t('home')}
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

function Success({ variant, onDone }: { variant: PassBuyVariant; onDone?: () => void }) {
  const t = useTranslations('pass.buy');
  const email = useAuthStore((st) => st.user?.email ?? '');
  const nick = useGuestStore((st) => st.nick);
  const flagCode = useGuestStore((st) => st.flagCode ?? st.detectedFlag ?? 'earth');
  const name = nick?.trim() || email.split('@')[0] || '';
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const works: { icon: 'ticket' | 'calendar' | 'filter' | 'seat'; key: string }[] = [
    { icon: 'ticket', key: 'worksBadge' },
    { icon: 'calendar', key: 'worksSchedule' },
    { icon: 'filter', key: 'worksQuiet' },
    { icon: 'seat', key: 'worksDiscount' },
  ];
  return (
    <div className={col(variant)} data-phase="success">
      <div className={s.success}>
        {CONFETTI}
        <span role="status" className={s.successStatus}>
          <AuthIcon name="tick" size={16} />
          {t('successStatus')}
        </span>
        <h3 ref={ref} tabIndex={-1} className={cn(s.successTitle, 'focus:outline-none')}>
          {t('successTitle')}
        </h3>
      </div>
      <div role="img" aria-label={t('ticketLabel', { name })} className={s.ticket}>
        <div className={s.ticketMain}>
          <span className={s.ticketBrand}>{t('ticketBrand')}</span>
          <span className={s.ticketName}>{t('ticketName')}</span>
          <span className={s.ticketWho}>
            <Flag code={flagCode} size="xs" decorative />
            <span>{name}</span>
          </span>
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
              <AuthIcon name={w.icon} size={15} />
            </span>
            {t(w.key)}
          </li>
        ))}
      </ul>
      <DoneButton variant={variant} onDone={onDone} mt={18} />
      <p className={cn(s.note, s.noteSm)} style={{ marginTop: 14 }}>
        <AuthIcon name="user" size={18} />
        <span>{t.rich('signedAs', { email, b: Bold })}</span>
      </p>
      <LinkRow items={[t('terms')]} mt={2} />
    </div>
  );
}

function Active({ variant, onDone }: { variant: PassBuyVariant; onDone?: () => void }) {
  const t = useTranslations('pass.buy');
  const p = useTranslations('pass.page');
  const user = useAuthStore((st) => st.user);
  const since = useAuthStore((st) => (st.user ? st.passes[st.user.email] : undefined));
  const bought = useBoughtPass();
  const date = since !== undefined ? new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' }).format(since) : null;
  return (
    <div className={col(variant)} data-phase="active">
      <div className={s.activeHead}>
        <span className={s.eyebrow}>
          <AuthIcon name="ticket" size={16} />
          {t('activeEyebrow')}
        </span>
        <span className={s.activeBadge}>
          <AuthIcon name="tick" size={14} />
          {p('active')}
        </span>
      </div>
      <h3 className={s.failTitle} style={{ marginTop: 14 }}>
        {t('activeTitle')}
      </h3>
      <p className={s.text}>{user && date ? t.rich('activeText', { date, email: user.email, b: Bold }) : t('activeTextDevice')}</p>
      <DoneButton variant={variant} onDone={onDone} mt={20} homeLabel={t('toHome')} />
      {variant === 'page' ? (
        <NextLink href="#" className={cn('t2f-focus', a.btn, a.ghost)} style={{ marginTop: 8 }}>
          {t('passport')}
        </NextLink>
      ) : null}
      {bought ? (
        <p className={s.discountRow}>
          <AuthIcon name="seat" size={18} />
          <span>{t.rich('activeDiscount', { price: formatUsd(2.49), b: Bold })}</span>
        </p>
      ) : null}
      <LinkRow items={[t('refunds'), t('help')]} mt={4} />
    </div>
  );
}

/** Тіло картки оформлення за поточним станом. */
export function PassBuy(props: PassBuyProps) {
  const view = usePassView();
  const signedIn = useAuthStore((st) => st.user !== null);
  const { variant, onDone } = props;
  switch (view) {
    case 'success':
      return <Success variant={variant} onDone={onDone} />;
    case 'active':
      return <Active variant={variant} onDone={onDone} />;
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
