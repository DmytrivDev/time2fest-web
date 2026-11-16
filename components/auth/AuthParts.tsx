'use client';

/**
 * Дрібні частини екранів входу за дошками `*-Auth-*`: поле email, Google (головна кнопка — рішення власника 2026-11-13),
 * роздільник, рядок помилки, віковий рядок, перемикач «вхід / реєстрація», поле коду з 6 цифр (`CodeField`), «Надіслати ще
 * раз» з відліком 30 с, «Надсилаємо…» на кнопках і блоки пасу (картка «Ще немає пасу?»,
 * розгорнута пропозиція, рядок у вікні під час трансляції).
 * «Оформити пас» — спокійна кнопка з жовтою межею (рішення 2026-10-29): веде до оформлення (`useGetPass`: вікно під
 * трансляцією чи сторінка `/pass/`). «Що дає пас» розгортає список можливостей на місці.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Reveal } from '@/components/primitives/Reveal';
import { PASS_HREF, useGetPass } from '@/components/pass/PassWindow';
import { IS_DEMO_BUILD } from '@/lib/env';
import { formatShortCountdown } from '@/lib/i18n/time';
import { useDevCode, useHasPass } from '@/lib/api/hooks/auth';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { Icon, GoogleMark, type IconName } from '@/components/primitives/Icon';
import s from './auth.module.css';

export { s as authStyles };

/** Перемальовує раз на секунду, доки `active` (відліки). */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function Bold(chunks: ReactNode) {
  return <b>{chunks}</b>;
}

export function Badge({ icon, tone = 'yel', className }: { icon: IconName; tone?: 'yel' | 'grey'; className?: string }) {
  return (
    <span aria-hidden="true" className={cn(s.badge, s[tone], className)}>
      <Icon name={icon} size={26} />
    </span>
  );
}

/** Рівень заголовка кроку: на сторінці — `h1`, у вікні під трансляцією (там уже є заголовок вікна) — `h3`. */
export const TitleLevel = createContext<'h1' | 'h3'>('h1');

export function Title({ children, afterBadge, id }: { children: ReactNode; afterBadge?: boolean; id?: string }) {
  const level = useContext(TitleLevel);
  const props = { id, tabIndex: -1, 'data-auth-title': '', className: cn(s.h1, afterBadge && s.h1AfterBadge, 'focus:outline-none') };
  return level === 'h3' ? <h3 {...props}>{children}</h3> : <h1 {...props}>{children}</h1>;
}

/** `mt` — відступ зверху з дошки (модульні відступи перекривають утиліти Tailwind). */
function mtStyle(mt?: number) {
  return mt === undefined ? undefined : { marginTop: mt };
}

export function Lead({ children, className, mt }: { children: ReactNode; className?: string; mt?: number }) {
  return (
    <p className={cn(s.lead, className)} style={mtStyle(mt)}>
      {children}
    </p>
  );
}

export function Note({ icon, children, mt }: { icon: IconName; children: ReactNode; mt?: number }) {
  return (
    <p className={s.note} style={mtStyle(mt)}>
      <Icon name={icon} size={18} />
      <span>{children}</span>
    </p>
  );
}

export function ErrorLine({ id, children, mt }: { id?: string; children: ReactNode; mt?: number }) {
  return (
    <p id={id} role="alert" className={s.error} style={mtStyle(mt)}>
      <Icon name="alert-bold" size={18} />
      <span>{children}</span>
    </p>
  );
}

/** `margin` — як на дошці (за замовчуванням 20px 0). */
export function Separator({ label, margin }: { label: string; margin?: string }) {
  return (
    <div role="separator" aria-label={label} className={s.sep} style={margin ? { margin } : undefined}>
      {label}
    </div>
  );
}

/** Google. `primary` — головна (коралова) кнопка кроку входу; у купівлі пасу головна — оплата, тож там Google спокійна. */
export function GoogleButton({ label, onClick, className, primary }: { label: string; onClick: () => void; className?: string; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('t2f-focus', s.btn, primary ? s.coral : s.second, className)} data-action="google">
      <GoogleMark />
      {label}
    </button>
  );
}

/** Маленьке коло, що крутиться, у кнопці «Надсилаємо…» / «Перевіряємо…» (колір — від тексту кнопки). */
export function BusyDot() {
  return <span aria-hidden="true" className={s.busyDot} />;
}

/**
 * Кнопка дії, що йде на сервер: поки запит у дорозі — «Надсилаємо…» з колом, `aria-busy`, повторне натискання
 * ігнорується (кнопка лишається у фокусі, тож не `disabled`).
 */
export function BusyButton({
  busy,
  busyLabel,
  children,
  tone = 'second',
  type = 'submit',
  onClick,
  className,
  action,
}: {
  busy: boolean;
  busyLabel: string;
  children: ReactNode;
  tone?: 'coral' | 'second' | 'ghost';
  type?: 'submit' | 'button';
  onClick?: () => void;
  className?: string;
  action?: string;
}) {
  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
      className={cn('t2f-focus', s.btn, s[tone], busy && s.busy, className)}
      data-action={action}
    >
      {busy ? <BusyDot /> : null}
      {busy ? busyLabel : children}
    </button>
  );
}

/**
 * Поле коду з листа: одне поле на 6 цифр (`inputMode="numeric"`, `autoComplete="one-time-code"` — телефон підставить код
 * з листа сам), вставка «123 456» чи «123456» працює, на 6-й цифрі — перевірка (`onComplete`).
 */
export function CodeField({
  value,
  onChange,
  error,
  status,
  disabled,
  focusOnMount,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: ReactNode;
  /** «Перевіряємо…» — під полем, ввічливо. */
  status?: ReactNode;
  disabled?: boolean;
  /** Фокус у поле, щойно крок відкрився (код уже йде листом). */
  focusOnMount?: boolean;
  label: string;
}) {
  const uid = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus({ preventScroll: true });
  }, [focusOnMount]);
  useEffect(() => {
    if (error && !disabled) ref.current?.focus();
  }, [error, disabled]);
  return (
    <div className="flex flex-col">
      <label htmlFor={`${uid}-code`} className={s.label}>
        {label}
      </label>
      <input
        ref={ref}
        id={`${uid}-code`}
        name="one-time-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        spellCheck={false}
        placeholder="••••••"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${uid}-err` : status ? `${uid}-status` : undefined}
        className={cn('t2f-nk-input', s.field, s.codeField)}
        data-field="code"
      />
      {error ? (
        <ErrorLine id={`${uid}-err`} mt={8}>
          {error}
        </ErrorLine>
      ) : null}
      <p id={`${uid}-status`} role="status" className={cn(s.hint, s.codeStatus)}>
        {status ?? ''}
      </p>
    </div>
  );
}

/**
 * Демо-збірка: листів немає — код видно під полем у позначеному блоці (той самий пунктир, що в тестових засобах).
 * У тестовій збірці код — у машині часу й `window.__t2f.lastCode()`; у робочій цього блоку немає.
 */
export function DemoCodeHint({ purpose = 'signin' }: { purpose?: 'signin' | 'email-change' }) {
  const t = useTranslations('auth.code');
  const box = useDevCode();
  const c = box?.code ?? null;
  if (!IS_DEMO_BUILD || !c || c.used || c.purpose !== purpose) return null;
  return (
    <p className={s.demoHint} data-demo-code="">
      <span className={s.mailboxTitle}>{t('demo')}</span>
      <span>{t.rich('demoText', { code: c.code, b: Bold })}</span>
    </p>
  );
}

export function EmailField({
  value,
  onChange,
  hint,
  error,
  autoFocus,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  hint: ReactNode;
  error?: string | null;
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  const t = useTranslations('auth.email');
  const uid = useId();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return (
    <div className="flex flex-col">
      <label htmlFor={`${uid}-email`} className={s.label}>
        {t('label')}
      </label>
      <input
        ref={ref}
        id={`${uid}-email`}
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        placeholder={t('placeholder')}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[error ? `${uid}-err` : null, `${uid}-hint`].filter(Boolean).join(' ')}
        className={cn('t2f-nk-input', s.field)}
      />
      {error ? (
        <ErrorLine id={`${uid}-err`} mt={8}>
          {error}
        </ErrorLine>
      ) : null}
      <p id={`${uid}-hint`} className={s.hint}>
        {hint}
      </p>
    </div>
  );
}

export function AgeLine({ mode, mt }: { mode: 'signin' | 'signup'; mt?: number }) {
  const t = useTranslations('auth');
  return (
    <p className={s.age} style={mtStyle(mt)}>
      {t.rich(mode === 'signup' ? 'ageSignup' : 'ageSignin', {
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
  );
}

/** «Ще немає акаунта? Створити акаунт» / «Вже є акаунт? Увійти»: на сторінці — посилання, у вікні — кнопка. */
export function SwitchRow({
  question,
  label,
  href,
  onClick,
  mt,
}: {
  question: string;
  label: string;
  href: string;
  onClick?: () => void;
  mt?: number;
}) {
  return (
    <p className={s.switchRow} style={mtStyle(mt)}>
      {question}
      {onClick ? (
        <button type="button" onClick={onClick} className="t2f-focus">
          {label}
        </button>
      ) : (
        <NextLink href={href} className="t2f-focus">
          {label}
        </NextLink>
      )}
    </p>
  );
}

/** «Надіслати ще раз» з відліком 30 с до нового коду; після відліку — звичайна кнопка; у дорозі — «Надсилаємо…». */
export function ResendButton({
  until,
  onResend,
  enabledLabel,
  className,
  busy,
}: {
  until: number | null;
  onResend: () => void;
  enabledLabel?: string;
  className?: string;
  busy?: boolean;
}) {
  const t = useTranslations('auth.code');
  const ta = useTranslations('auth');
  const uid = useId();
  const now = useTick(until !== null);
  const left = until !== null ? until - now : 0;
  if (left > 0) {
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={`${uid}-resend`}
          onClick={(e) => e.preventDefault()}
          className={cn('t2f-focus', s.btn, s.disabled, className)}
        >
          <Icon name="refresh" size={20} />
          {t('resend')}
        </button>
        <p id={`${uid}-resend`} className={cn(s.hint, s.center)}>
          {t.rich('resendIn', { time: formatShortCountdown(left), b: Bold })}
        </p>
      </>
    );
  }
  return (
    <BusyButton type="button" busy={!!busy} busyLabel={ta('sending')} tone="ghost" onClick={onResend} className={className} action="resend">
      <Icon name="refresh" size={20} />
      {enabledLabel ?? t('resend')}
    </BusyButton>
  );
}

const PERKS = [
  { icon: 'calendar-time', key: 'schedule' },
  { icon: 'ticket', key: 'path' },
  { icon: 'card', key: 'card' },
  { icon: 'filter', key: 'quiet' },
] as const;
/** Три головні можливості; решта — під «Що ще дає пас». */
const MAIN_PERKS = 3;

/** Рядок можливості: значок у колонці 40 px (на одній осі зі значком заголовка картки), назва й пояснення. */
function PerkItem({ icon, name, text, dense }: { icon: IconName; name: string; text: string; dense?: boolean }) {
  return (
    <li className={s.offerItem}>
      <span aria-hidden="true" className={dense ? s.iconCol : undefined}>
        <span className={cn(s.dot, s.yel, dense ? s.badgeXs : s.badgeSm)}>
          <Icon name={icon} size={dense ? 16 : 18} />
        </span>
      </span>
      <span>
        <span className={s.offerName}>{name}</span>
        <span className={s.offerText}>{text}</span>
      </span>
    </li>
  );
}

/**
 * Можливості пасу рядками з жовтими значками. `from`/`to` — зріз списку.
 * `dense` — усередині картки: під тонкою лінією, значки на одній осі зі значком заголовка, текст — на одному рівні з ним
 * (правка власника 2026-10-29: без «каскаду»).
 */
export function PassPerks({ from = 0, to = PERKS.length, dense, id }: { from?: number; to?: number; dense?: boolean; id?: string }) {
  const t = useTranslations('auth.passOffer');
  return (
    <ul id={id} className={cn(s.offerList, dense && s.perksDense)} data-block="pass-perks">
      {PERKS.slice(from, to).map((it) => (
        <PerkItem key={it.key} icon={it.icon} name={t(it.key)} text={t(`${it.key}Text`)} dense={dense} />
      ))}
    </ul>
  );
}

/** «Дізнатись більше про Новорічний пас →» — сторінка пасу (правка власника 2026-10-30): під кнопками розгорнутої картки. */
export function PassMoreLink({ className }: { className?: string }) {
  const t = useTranslations('auth.passHint');
  return (
    <NextLink href="/pass/" className={cn('t2f-focus', s.moreLink, className)}>
      {t('more')}
      <Icon name="arrow-right" size={16} />
    </NextLink>
  );
}

/** «Що дає пас» ↔ «Згорнути»: розгортає можливості на місці. */
function ToggleButton({
  open,
  onToggle,
  controls,
  label,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  label: string;
  className: string;
}) {
  const t = useTranslations('auth.passHint');
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className={className}>
      {open ? t('collapse') : label}
    </button>
  );
}

/**
 * «Оформити пас» у картках пасу. Сторінки `/login/` і `/signup/` — поза макетом трансляцій, вікна там немає, тож
 * кнопка нічого не робила (правка власника 2026-11-10): тут це перехід на сторінку «Новорічний пас» `/pass/` — там
 * можливості пасу й оформлення з входом (Google чи email: акаунт створюється з оплатою). У вікні входу під
 * трансляцією — вікно оформлення на місці (`useGetPass`).
 */
function GetPassButton({ toPage, className, children }: { toPage?: boolean; className: string; children: ReactNode }) {
  const getPass = useGetPass();
  if (toPage)
    return (
      <NextLink href={PASS_HREF} className={className} data-action="get-pass">
        {children}
      </NextLink>
    );
  return (
    <button type="button" onClick={() => getPass()} className={className} data-action="get-pass">
      {children}
    </button>
  );
}

/** Вхід і реєстрація: «Ще немає Новорічного пасу?» — коротко, ціна, «Оформити пас», «Що дає пас». `toPage` — див. `GetPassButton`. */
export function PassHint({ className, toPage }: { className?: string; toPage?: boolean }) {
  const hasPass = useHasPass();
  const t = useTranslations('auth.passHint');
  const o = useTranslations('offers');
  const uid = useId();
  const [open, setOpen] = useState(false);
  // Пас уже є (на акаунті чи на пристрої): пропозиції немає (правка власника 2026-11-16).
  if (hasPass) return null;
  return (
    <section aria-labelledby={`${uid}-t`} className={cn(s.gold, s.passHint, className)} data-block="pass-hint">
      <div className={s.passHintHead}>
        <span aria-hidden="true" className={cn(s.dot, s.yel, s.badgeMd)}>
          <Icon name="ticket" size={20} />
        </span>
        <span>
          <span id={`${uid}-t`} role="heading" aria-level={2} className={s.passHintTitle}>
            {t('title')}
          </span>
          <span className={s.passHintText}>{t('text')}</span>
        </span>
      </div>
      <Reveal open={open} className={s.colReveal}>
        <PassPerks id={`${uid}-more`} dense />
        <span aria-hidden="true" className={s.perksGap} />
      </Reveal>
      <div className={s.priceRow}>
        <span className={s.priceSm}>{formatUsd(PASS_PRICE)}</span>
        <span className={s.priceNote}>{o('priceNote')}</span>
      </div>
      <div className={s.pair}>
        <GetPassButton toPage={toPage} className={cn('t2f-focus', s.btn, s.passBtn)}>
          {t('get')}
        </GetPassButton>
        <ToggleButton
          open={open}
          onToggle={() => setOpen((v) => !v)}
          controls={`${uid}-more`}
          label={t('what')}
          className={cn('t2f-focus', s.btn, s.ghost)}
        />
      </div>
      <Reveal open={open} className={s.colReveal}>
        <PassMoreLink />
      </Reveal>
    </section>
  );
}

/** «Акаунт створено»: розгорнута пропозиція пасу. `toPage` — див. `GetPassButton`. */
export function PassOfferCard({ welcome, className, toPage }: { welcome?: boolean; className?: string; toPage?: boolean }) {
  const hasPass = useHasPass();
  const t = useTranslations('auth.passOffer');
  const o = useTranslations('offers');
  const uid = useId();
  const [open, setOpen] = useState(false);
  if (hasPass) return null;
  return (
    <section aria-labelledby={`${uid}-t`} className={cn(s.gold, s.offer, className)} data-block="pass-offer">
      <span className={s.eyebrow}>
        <Icon name="ticket" size={16} />
        {t('eyebrow')}
      </span>
      <h2 id={`${uid}-t`} className={s.offerTitle}>
        {welcome ? t('titleWelcome') : t('title')}
      </h2>
      <PassPerks to={MAIN_PERKS} />
      <Reveal open={open}>
        <div className={s.perksMore}>
          <PassPerks id={`${uid}-more`} from={MAIN_PERKS} />
        </div>
      </Reveal>
      <div className={s.priceRow} style={mtStyle(18)}>
        <span className={s.priceLg}>{formatUsd(PASS_PRICE)}</span>
        <span className={s.priceLgNote}>{o('priceNote')}</span>
      </div>
      <GetPassButton toPage={toPage} className={cn('t2f-focus', s.btn, s.passBtn, s.mt16)}>
        {t('get', { price: formatUsd(PASS_PRICE) })}
      </GetPassButton>
      <ToggleButton
        open={open}
        onToggle={() => setOpen((v) => !v)}
        controls={`${uid}-more`}
        label={t('more')}
        className={cn('t2f-focus self-center', s.linkBtn, s.mt8)}
      />
      <Reveal open={open} className={s.offerLinkReveal}>
        <PassMoreLink className="mx-auto" />
      </Reveal>
      <p className={cn(s.hint, s.center)} style={mtStyle(8)}>
        {t('note')}
      </p>
    </section>
  );
}

/** Вікно під час трансляції: «Ще немає пасу? $5 разово, на весь сезон» і дві кнопки. */
export function PassRow({ mt }: { mt?: number }) {
  const t = useTranslations('auth');
  const uid = useId();
  const [open, setOpen] = useState(false);
  const getPass = useGetPass();
  const hasPass = useHasPass();
  if (hasPass) return null;
  return (
    <div className={s.passRow} style={mtStyle(mt)} data-block="pass-row">
      <span className={s.passRowText}>
        <span aria-hidden="true" className={s.iconCol}>
          <span className={cn(s.dot, s.yel, s.badgeXs)}>
            <Icon name="ticket" size={16} />
          </span>
        </span>
        <span>{t.rich('passRow', { price: formatUsd(PASS_PRICE), b: Bold })}</span>
      </span>
      <Reveal open={open} className={s.colReveal}>
        <PassPerks id={`${uid}-more`} dense />
        <span aria-hidden="true" className={s.perksGap} />
      </Reveal>
      <span className={s.pair}>
        <button type="button" onClick={() => getPass()} className={cn('t2f-focus', s.btn, s.passBtn)}>
          {t('passHint.get')}
        </button>
        <ToggleButton
          open={open}
          onToggle={() => setOpen((v) => !v)}
          controls={`${uid}-more`}
          label={t('passHint.what')}
          className={cn('t2f-focus', s.btn, s.ghost)}
        />
      </span>
      <Reveal open={open} className={s.colReveal}>
        <PassMoreLink />
      </Reveal>
    </div>
  );
}

const ACCOUNT_PERKS = [
  { icon: 'rubber-stamp', key: 'passport' },
  { icon: 'calendar-time', key: 'schedule' },
  { icon: 'ticket', key: 'purchases' },
] as const;

/**
 * «Безплатний акаунт» карткою — так само зібрана, як картка пасу під нею (значок заголовка й рядків на одній осі),
 * тож дві картки читаються як дві пропозиції поруч (вікно під трансляцією; на сторінці — ліва колонка `WhyCard`).
 */
export function AccountPerks() {
  const t = useTranslations('auth');
  const uid = useId();
  return (
    <section aria-labelledby={`${uid}-t`} className={s.accountCard} data-block="account-perks">
      <div className={s.passHintHead}>
        <span aria-hidden="true" className={cn(s.dot, s.grey, s.badgeMd)}>
          <Icon name="user" size={20} />
        </span>
        <span>
          <span id={`${uid}-t`} role="heading" aria-level={2} className={s.passHintTitle}>
            {t('stream.accountTitle')}
          </span>
          <span className={s.passHintText}>{t('stream.accountText')}</span>
        </span>
      </div>
      <ul className={cn(s.offerList, s.perksDense)}>
        {ACCOUNT_PERKS.map((it) => (
          <PerkItem key={it.key} icon={it.icon} name={t(`why.${it.key}`)} text={t(`why.${it.key}Text`)} dense />
        ))}
      </ul>
    </section>
  );
}
