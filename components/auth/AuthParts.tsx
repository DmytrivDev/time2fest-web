'use client';

/**
 * Дрібні частини екранів входу за дошками `*-Auth-*`: поле email, Google, роздільник, рядок помилки, віковий рядок,
 * перемикач «вхід / реєстрація», поле коду, «Надіслати ще раз» з відліком і блоки пасу (картка «Ще немає пасу?»,
 * розгорнута пропозиція, рядок у вікні під час трансляції).
 * «Оформити пас» — спокійна кнопка з жовтою межею (рішення 2026-10-29): веде до оформлення (`useGetPass`: вікно під
 * трансляцією чи сторінка `/pass/`). «Що дає пас» розгортає список можливостей на місці.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Reveal } from '@/components/primitives/Reveal';
import { useGetPass } from '@/components/pass/PassWindow';
import { formatCountdown } from '@/lib/auth/sim';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { AuthIcon, GoogleMark, type AuthIconName } from './icons';
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

export function Badge({ icon, tone = 'yel', className }: { icon: AuthIconName; tone?: 'yel' | 'grey'; className?: string }) {
  return (
    <span aria-hidden="true" className={cn(s.badge, s[tone], className)}>
      <AuthIcon name={icon} size={26} />
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

export function Note({ icon, children, mt }: { icon: AuthIconName; children: ReactNode; mt?: number }) {
  return (
    <p className={s.note} style={mtStyle(mt)}>
      <AuthIcon name={icon} size={18} />
      <span>{children}</span>
    </p>
  );
}

export function ErrorLine({ id, children, mt }: { id?: string; children: ReactNode; mt?: number }) {
  return (
    <p id={id} role="alert" className={s.error} style={mtStyle(mt)}>
      <AuthIcon name="alert" size={18} />
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

export function GoogleButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('t2f-focus', s.btn, s.second, className)}>
      <GoogleMark />
      {label}
    </button>
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
        // Сторінки політики ще немає — як у футері, інертне посилання.
        privacy: (c) => (
          <NextLink href="#" className="t2f-focus">
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

/** «Надіслати ще раз» з відліком до нового листа; після відліку — звичайна кнопка. */
export function ResendButton({
  until,
  onResend,
  enabledLabel,
  className,
}: {
  until: number | null;
  onResend: () => void;
  enabledLabel?: string;
  className?: string;
}) {
  const t = useTranslations('auth.sent');
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
          <AuthIcon name="refresh" />
          {t('resend')}
        </button>
        <p id={`${uid}-resend`} className={cn(s.hint, s.center)}>
          {t.rich('resendIn', { time: formatCountdown(left), b: Bold })}
        </p>
      </>
    );
  }
  return (
    <button type="button" onClick={onResend} className={cn('t2f-focus', s.btn, s.ghost, className)}>
      <AuthIcon name="refresh" />
      {enabledLabel ?? t('resend')}
    </button>
  );
}

const PERKS = [
  { icon: 'calendar', key: 'schedule' },
  { icon: 'ticket', key: 'path' },
  { icon: 'spark', key: 'discount' },
  { icon: 'card', key: 'card' },
  { icon: 'moon', key: 'quiet' },
] as const;
/** Три головні можливості; решта — під «Що ще дає пас». */
const MAIN_PERKS = 3;

/** Рядок можливості: значок у колонці 40 px (на одній осі зі значком заголовка картки), назва й пояснення. */
function PerkItem({ icon, name, text, dense }: { icon: AuthIconName; name: string; text: string; dense?: boolean }) {
  return (
    <li className={s.offerItem}>
      <span aria-hidden="true" className={dense ? s.iconCol : undefined}>
        <span className={cn(s.dot, s.yel, dense ? s.badgeXs : s.badgeSm)}>
          <AuthIcon name={icon} size={dense ? 16 : 18} />
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
      <AuthIcon name="arrow-right" size={16} />
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

/** Вхід і реєстрація: «Ще немає Новорічного пасу?» — коротко, ціна, «Оформити пас», «Що дає пас». */
export function PassHint({ className }: { className?: string }) {
  const t = useTranslations('auth.passHint');
  const o = useTranslations('offers');
  const uid = useId();
  const [open, setOpen] = useState(false);
  const getPass = useGetPass();
  return (
    <section aria-labelledby={`${uid}-t`} className={cn(s.gold, s.passHint, className)} data-block="pass-hint">
      <div className={s.passHintHead}>
        <span aria-hidden="true" className={cn(s.dot, s.yel, s.badgeMd)}>
          <AuthIcon name="ticket" />
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
        <button type="button" onClick={() => getPass()} className={cn('t2f-focus', s.btn, s.passBtn)}>
          {t('get')}
        </button>
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

/** «Акаунт створено»: розгорнута пропозиція пасу. */
export function PassOfferCard({ welcome, className }: { welcome?: boolean; className?: string }) {
  const t = useTranslations('auth.passOffer');
  const o = useTranslations('offers');
  const uid = useId();
  const [open, setOpen] = useState(false);
  const getPass = useGetPass();
  return (
    <section aria-labelledby={`${uid}-t`} className={cn(s.gold, s.offer, className)} data-block="pass-offer">
      <span className={s.eyebrow}>
        <AuthIcon name="ticket" size={16} />
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
      <button type="button" onClick={() => getPass()} className={cn('t2f-focus', s.btn, s.passBtn, s.mt16)}>
        {t('get', { price: formatUsd(PASS_PRICE) })}
      </button>
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

/** Вікно під час трансляції: «Ще немає пасу? $4,99 разово, на весь сезон» і дві кнопки. */
export function PassRow({ mt }: { mt?: number }) {
  const t = useTranslations('auth');
  const uid = useId();
  const [open, setOpen] = useState(false);
  const getPass = useGetPass();
  return (
    <div className={s.passRow} style={mtStyle(mt)} data-block="pass-row">
      <span className={s.passRowText}>
        <span aria-hidden="true" className={s.iconCol}>
          <span className={cn(s.dot, s.yel, s.badgeXs)}>
            <AuthIcon name="ticket" size={16} />
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
  { icon: 'stamp', key: 'passport' },
  { icon: 'calendar', key: 'schedule' },
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
          <AuthIcon name="user" />
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
