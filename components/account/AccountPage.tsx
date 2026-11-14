'use client';

/**
 * Кабінет `/account/` за дошками `Desk-Cabinet-New2` / `Desk-Cabinet-New3` (рішення власника 2026-11-08; пароля немає —
 * вхід через Google або кодом із листа, рішення 2026-11-13). Ліворуч — один аркуш із розділами «Профіль» (аватар, нік,
 * прапор, плашка пасу, «Як ти входиш»: Google першим, зміна пошти кодом), «Налаштування», «Сповіщення», «Дані й акаунт».
 * Записи на сервер показують «Зберігаємо…» і «Не вдалося зберегти» (стани для `http`, у `sim` — затримки й відмови
 * `window.__t2f.api`). Десктоп: праворуч на місці чату — меню кабінету
 * (розділи, «Моє свято», «Вийти»); «☰ Меню» в шапці відкриває звичайне меню на тому ж місці. Телефон: чату немає, кнопка
 * розділів закріплена внизу — шторка. Гість — на вхід (з поверненням сюди).
 */
import { AccountSkeleton } from '@/components/skeleton/LiveSkeletons';
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOpenPassWindow } from '@/components/pass/PassWindow';
import { useHeaderPass, useHeaderUser, useHydrated } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { Sheet } from '@/components/primitives/Sheet';
import { Switch } from '@/components/primitives/Switch';
import { HeaderAvatar } from '@/components/shell/Header';
import { MENU_LANGUAGES } from '@/components/shell/Menu';
import { CLOSE_MS, useChatColumn, useOverlayOpen } from '@/components/shell/OverlayManager';
import { NotifSettings } from '@/components/notifications/NotificationsBody';
import { FlagField } from '@/components/windows/FlagField';
import { BusyButton, CodeField, DemoCodeHint, ResendButton } from '@/components/auth/AuthParts';
import { authCodeError } from '@/lib/api/contracts/auth';
import type { ApiResult } from '@/lib/api/result';
import { formatClock } from '@/lib/i18n/time';
import { useStamps } from '@/lib/api/hooks/passport';
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { validateNick, type NickIssue } from '@/lib/chat/nick';
import { NICK_MAX } from '@/lib/chat/send';
import { getData } from '@/lib/data/load';
import { isCelebrating } from '@/lib/engine/celebration';
import { detectFlag } from '@/lib/geo/detectFlag';
import { utcLabel } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { useAccountStore } from '@/stores/account';
import { authActions, profileActions, useProfile, useSession } from '@/lib/api/hooks/auth';
import { useGuestStore } from '@/stores/guest';
import s from './account.module.css';

const SECTIONS = [
  { id: 'profile', icon: 'user' },
  { id: 'settings', icon: 'filter' },
  { id: 'notifications', icon: 'bell' },
  { id: 'data', icon: 'shield-check' },
] as const satisfies readonly { id: string; icon: IconName }[];
type SectionId = (typeof SECTIONS)[number]['id'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** Запис на сервер з «Зберігаємо…» / «Збережено» / «Не вдалося зберегти» (у `sim` — `window.__t2f.api`). */
function useSave() {
  const [state, setState] = useState<SaveState>('idle');
  const run = async <T,>(p: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
    setState('saving');
    const res = await p;
    setState(res.ok ? 'saved' : 'failed');
    return res;
  };
  return { state, run, reset: () => setState('idle') };
}

/** Рядок стану запису під розділом: «Зберігаємо…» чи «Не вдалося зберегти зміну». */
function SaveLine({ state, failed }: { state: SaveState; failed: string }) {
  const t = useTranslations('account.save');
  if (state === 'saving')
    return (
      <p className={cn(s.hint, s.saveLine)} role="status">
        <span className={s.spin} aria-hidden="true" />
        {t('saving')}
      </p>
    );
  if (state === 'failed')
    return (
      <p className={cn(s.err, s.saveLine)} role="alert">
        <Icon name="alert" size={16} />
        {failed}
      </p>
    );
  return null;
}

/** Пояси країни з назвою за головним містом поясу (без бази всіх міст, власник 2026-11-08). */
function countryZones(iso: string) {
  const data = getData();
  const c = data.countriesByIso.get(iso);
  if (!c) return [];
  return c.zoneIds
    .map((id) => data.zonesById.get(id))
    .filter((z): z is NonNullable<typeof z> => !!z)
    .sort((a, b) => b.offsetMinutes - a.offsetMinutes)
    .map((z) => {
      const inZone = data.cities.filter((x) => x.countryIso === iso && x.zoneId === z.id);
      const city = inZone.find((x) => x.isCountryMain) ?? inZone[0] ?? data.citiesById.get(z.representativeCityId);
      return { id: z.id, label: utcLabel(z.offsetMinutes), city: city?.name.uk ?? '' };
    });
}

function Row({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowTitle}>{title}</div>
        {hint ? <div className={s.rowHint}>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; lang?: string }[]; onChange(v: T): void }) {
  return (
    <div role="radiogroup" aria-label={label} className={s.seg}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          lang={o.lang}
          onClick={() => onChange(o.value)}
          className={cn('t2f-focus t2f-transition', s.segItem)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Рядок-перемикач: назва й пояснення ліворуч, доріжка праворуч (уся смуга назви — ціль). */
function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <div className={s.toggleRow}>
      <Switch label={<span className={s.rowTitle}>{label}</span>} checked={checked} disabled={disabled} onCheckedChange={onChange} className={s.switch} />
      <div className={s.rowHint}>{hint}</div>
    </div>
  );
}

/* ---------- Профіль ---------- */

function ProfileSection({ hasPass }: { hasPass: boolean }) {
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
      <LoginBlock />
    </section>
  );
}

function PassPlaque({ hasPass }: { hasPass: boolean }) {
  const t = useTranslations('account.pass');
  const openPass = useOpenPassWindow();
  const celebrating = isCelebrating(useNow({ granularity: 'minute' }), getData());
  return (
    <div className={cn(s.plaque, hasPass ? s.plaqueOn : s.plaqueOff)} data-block="pass-plaque" data-pass={hasPass ? 'active' : 'inactive'}>
      <span aria-hidden="true" className={s.plaqueIcon}>
        <Icon name="ticket" size={22} />
      </span>
      <div className={s.plaqueText}>
        <div className={s.plaqueTitle}>
          {t('title')}
          <span className={cn(s.status, hasPass ? s.statusOn : s.statusOff)}>{hasPass ? t('active') : t('inactive')}</span>
        </div>
        <p className={s.plaqueHint}>{hasPass ? t('activeText') : t.rich('inactiveText', { b: (x) => <b>{x}</b> })}</p>
      </div>
      <div className={s.plaqueActs}>
        {hasPass ? (
          <>
            {/* TODO(квитанція): посилання на квитанцію PayPro — поки сторінка «Оплата й повернення». */}
            <NextLink href="/payments/" className={cn('t2f-focus', s.link)}>
              {t('receipt')}
            </NextLink>
            <NextLink href="/pass/" className={cn('t2f-focus t2f-transition', s.btn, s.line)}>
              {t('what')}
            </NextLink>
          </>
        ) : (
          <>
            <NextLink href="/pass/" className={cn('t2f-focus', s.link, s.under)}>
              {t('more')}
            </NextLink>
            <NextLink
              href="/pass/"
              onClick={(e) => {
                if (!celebrating) return;
                e.preventDefault();
                openPass();
              }}
              className={cn('t2f-focus t2f-transition', s.btn, s.gold)}
            >
              {t('get')}
            </NextLink>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * «Як ти входиш»: Google — першим (головний спосіб, рішення власника 2026-11-13), далі пошта, далі «Вийти на всіх».
 * Зміна пошти — тим самим кодом із 6 цифр, що й вхід: нова адреса → «Надіслати код» («Надсилаємо…») → поле коду
 * (вхід на 6-й цифрі, «Перевіряємо…», помилки, «Надіслати ще раз» з відліком) → «Пошту змінено». Рядки — під лінією
 * `.rows`, тож підзаголовок «Пароля немає…» не налазить на першу лінію (перевірка дошок 2026-11-14).
 */
function LoginBlock() {
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

/* ---------- Налаштування ---------- */

function ZonePicker({ onDone }: { onDone(): void }) {
  const t = useTranslations('account.settings');
  const acc = useAccountStore();
  const autoIso = useMemo(() => (useGuestStore.getState().detectedFlag ?? detectFlag() ?? 'UA').toUpperCase(), []);
  const [iso, setIso] = useState(acc.homeCountry ?? autoIso);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const data = getData();
  const country = data.countriesByIso.get(iso);
  const zones = countryZones(iso);
  // Порожній пошук — увесь список (поточна країна першою), а не порожнє поле без підказок (перевірка дошок 2026-11-14).
  const all = useMemo(() => [...data.countries].sort((a, b) => a.name.uk.localeCompare(b.name.uk, 'uk')), [data]);
  const found = query.trim()
    ? data.countries.filter((x) => x.name.uk.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [...all.filter((x) => x.iso === iso), ...all.filter((x) => x.iso !== iso)];
  const zoneId = acc.homeCountry === iso && acc.homeZoneId ? acc.homeZoneId : zones[0]?.id;

  return (
    <div className={s.picker} data-block="zone-picker">
      <div className={s.label}>{t('country')}</div>
      {picking ? (
        <div className={s.search}>
          <input
            ref={(el) => el?.focus()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setPicking(false);
                setQuery('');
              }
            }}
            placeholder={t('countrySearch')}
            aria-label={t('countrySearch')}
            className="t2f-nk-input"
          />
          {found.length ? (
            <ul className={cn(s.options, !query.trim() && s.optionsAll)} data-list={query.trim() ? 'found' : 'all'}>
              {found.map((x) => (
                <li key={x.iso}>
                  <button
                    type="button"
                    onClick={() => {
                      setIso(x.iso);
                      setPicking(false);
                      setQuery('');
                      const z = countryZones(x.iso);
                      void profileActions.update({ settings: { homeCountry: x.iso } });
                      void profileActions.update({ settings: { homeZoneId: z[0]?.id ?? null } });
                    }}
                    className={cn('t2f-focus t2f-transition', s.option)}
                  >
                    <Flag code={x.flagCode} size="sm" decorative />
                    {x.name.uk}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} className={cn('t2f-focus t2f-transition', s.countryBtn)}>
          {country ? <Flag code={country.flagCode} size="sm" decorative /> : null}
          <span className={s.countryName}>{country?.name.uk ?? iso}</span>
          <Icon name="chevron-down" size={16} className={s.chev} />
        </button>
      )}
      {zones.length > 1 ? (
        <>
          <div className={s.label} style={{ marginTop: '0.875rem' }}>
            {t('zonePick', { count: zones.length })}
          </div>
          <div role="radiogroup" aria-label={t('zone')} className={s.zones}>
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                role="radio"
                aria-checked={z.id === zoneId}
                onClick={() => {
                  void profileActions.update({ settings: { homeCountry: iso } });
                  void profileActions.update({ settings: { homeZoneId: z.id } });
                }}
                className={cn('t2f-focus t2f-transition', s.zone)}
              >
                <span className={s.zoneUtc}>{z.label}</span>
                <span className={s.zoneCity}>{z.city}</span>
                {z.id === zoneId ? <Icon name="check" size={16} className={s.zoneCheck} /> : null}
              </button>
            ))}
          </div>
        </>
      ) : zones[0] ? (
        <p className={s.hint}>{t.rich('zoneOne', { zone: `${zones[0].label} · ${zones[0].city}`, b: (x) => <b>{x}</b> })}</p>
      ) : null}
      <div className={s.inlineActs}>
        <button type="button" onClick={onDone} className={cn('t2f-focus t2f-transition', s.btn, s.line)}>
          {t('done')}
        </button>
        <button
          type="button"
          onClick={() => {
            void profileActions.update({ settings: { homeCountry: null } });
            void profileActions.update({ settings: { homeZoneId: null } });
            setIso(autoIso);
          }}
          className={cn('t2f-focus', s.link)}
        >
          <Icon name="map" size={16} />
          {t('auto')}
        </button>
      </div>
    </div>
  );
}

function SettingsSection({ hasPass }: { hasPass: boolean }) {
  const t = useTranslations('account.settings');
  const sv = useTranslations('account.save');
  const acc = useAccountStore();
  const save = useSave();
  const setting = (patch: Parameters<typeof profileActions.update>[0]['settings']) => void save.run(profileActions.update({ settings: patch }));
  const locale = useGuestStore((g) => g.locale);
  const motion = useGuestStore((g) => g.reducedMotion);
  const setMotion = useGuestStore((g) => g.setReducedMotion);
  const [zoneOpen, setZoneOpen] = useState(false);
  const autoIso = useMemo(() => (useGuestStore.getState().detectedFlag ?? detectFlag() ?? 'UA').toUpperCase(), []);
  const iso = acc.homeCountry ?? autoIso;
  const zones = countryZones(iso);
  const zone = zones.find((z) => z.id === acc.homeZoneId) ?? zones[0];
  const place = `${getData().countriesByIso.get(iso)?.name.uk ?? iso}${zone ? ` · ${zone.label} · ${zone.city}` : ''}`;

  return (
    <section id="settings" aria-labelledby="settings-h" className={s.card}>
      <h2 id="settings-h" className={s.h2}>
        {t('title')}
      </h2>
      <p className={s.lead}>{t('lead')}</p>
      <div className={s.rows}>
        <Row title={t('timeFormat')} hint={t('timeFormatHint')}>
          <Seg
            label={t('timeFormat')}
            value={acc.hour12 ? 'h12' : 'h24'}
            options={[
              { value: 'h24', label: t('h24') },
              { value: 'h12', label: t('h12') },
            ]}
            onChange={(v) => setting({ hour12: v === 'h12' })}
          />
        </Row>
        <Row title={t('zone')} hint={acc.homeCountry ? t('zoneChosen', { place }) : t('zoneAuto', { place })}>
          {zoneOpen ? null : (
            <button type="button" onClick={() => setZoneOpen(true)} className={cn('t2f-focus', s.link)}>
              {t('change')}
            </button>
          )}
        </Row>
        <div className="t2f-reveal" data-open={zoneOpen}>
          <div className="t2f-reveal-inner">{zoneOpen ? <ZonePicker onDone={() => setZoneOpen(false)} /> : null}</div>
        </div>
        <Row title={t('language')} hint={t('languageHint')}>
          <Seg
            label={t('language')}
            value={locale}
            options={MENU_LANGUAGES.map((l) => ({ value: l.code as typeof locale, label: l.name, lang: l.code }))}
            onChange={(v) => useGuestStore.setState({ locale: v })}
          />
        </Row>
        <Toggle label={t('showPassport')} hint={t('showPassportHint')} checked={acc.showPassport} onChange={(v) => setting({ showPassport: v })} />
        <Toggle label={t('showPath')} hint={t('showPathHint')} checked={hasPass && acc.showPath} disabled={!hasPass} onChange={(v) => setting({ showPath: v })} />
        <Toggle label={t('hints')} hint={t('hintsHint')} checked={acc.passportHints} onChange={(v) => setting({ passportHints: v })} />
        <Toggle label={t('quiet')} hint={t('quietHint')} checked={hasPass && acc.quietDefault} disabled={!hasPass} onChange={(v) => setting({ quietDefault: v })} />
        <Toggle label={t('motion')} hint={t('motionHint')} checked={motion} onChange={setMotion} />
      </div>
      <SaveLine state={save.state} failed={sv('settingFailed')} />
    </section>
  );
}

function NotificationsSection() {
  const t = useTranslations('account.notifications');
  return (
    <section id="notifications" aria-labelledby="notifications-h" className={s.card}>
      <h2 id="notifications-h" className={s.h2}>
        {t('title')}
      </h2>
      <p className={s.lead}>{t('lead')}</p>
      <div className={s.rows}>
        <NotifSettings compact />
      </div>
    </section>
  );
}

function DataSection() {
  const t = useTranslations('account.data');
  const router = useRouter();
  const email = useSession().session?.user?.email ?? '';
  const sv = useTranslations('account.save');
  const [confirm, setConfirm] = useState(false);
  const del = useSave();
  const [downloadFailed, setDownloadFailed] = useState(false);
  const download = async () => {
    const res = await profileActions.exportData();
    setDownloadFailed(!res.ok);
    if (!res.ok) return;
    const payload = res.value;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'time2fest-dani.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const remove = async () => {
    if (del.state === 'saving') return;
    const res = await del.run(profileActions.deleteAccount());
    if (res.ok) router.push('/');
  };
  return (
    <section id="data" aria-labelledby="data-h" className={s.card}>
      <h2 id="data-h" className={s.h2}>
        {t('title')}
      </h2>
      <div className={s.rows}>
        <Row title={t('download')} hint={t('downloadHint')}>
          <button type="button" onClick={download} className={cn('t2f-focus', s.link)}>
            <Icon name="arrow-down" size={16} />
            {t('downloadBtn')}
          </button>
        </Row>
        {downloadFailed ? (
          <p className={cn(s.err, s.saveLine)} role="alert">
            <Icon name="alert" size={16} />
            {sv('downloadFailed')}
          </p>
        ) : null}
        <Row title={t('delete')} hint={t('deleteHint')}>
          {confirm ? null : (
            <button type="button" onClick={() => setConfirm(true)} className={cn('t2f-focus', s.link, s.danger)}>
              {t('deleteBtn')}
            </button>
          )}
        </Row>
        <div className="t2f-reveal" data-open={confirm}>
          <div className="t2f-reveal-inner">
            <div className={s.confirm} role="alert">
              <p>{t('deleteConfirm', { email })}</p>
              <div className={s.inlineActs}>
                <button
                  type="button"
                  onClick={remove}
                  aria-busy={del.state === 'saving' || undefined}
                  className={cn('t2f-focus t2f-transition', s.btn, s.dangerBtn)}
                >
                  {del.state === 'saving' ? <span className={s.spin} aria-hidden="true" /> : null}
                  {del.state === 'saving' ? sv('deleting') : t('deleteYes')}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className={cn('t2f-focus', s.link)}>
                  {t('deleteNo')}
                </button>
              </div>
              {del.state === 'failed' ? (
                <p className={cn(s.err, s.saveLine)} role="alert">
                  <Icon name="alert" size={16} />
                  {sv('deleteFailed')}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Меню кабінету ---------- */

function CabinetNav({ active, hasPass, onPick }: { active: SectionId; hasPass: boolean; onPick?: () => void }) {
  const t = useTranslations('account');
  const th = useTranslations('header');
  const user = useHeaderUser();
  const stamps = useStamps().length;
  const router = useRouter();
  if (!user) return null;
  const go = (id: SectionId) => {
    onPick?.();
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), onPick ? CLOSE_MS + 20 : 0);
  };
  return (
    <nav aria-label={t('navLabel')} className={s.nav} data-block="cabinet-nav">
      <div className={s.navWho}>
        <span className={s.navAvatar}>
          <HeaderAvatar user={user} pass={hasPass} label={th('passLabel')} />
        </span>
        <span>
          <b className={s.navName}>{user.name}</b>
          <span className={s.navSub}>{t('title')}</span>
        </span>
      </div>
      <ul className={s.navList}>
        {SECTIONS.map((x) => (
          <li key={x.id}>
            <a
              href={`#${x.id}`}
              aria-current={active === x.id ? 'location' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(x.id);
              }}
              className={cn('t2f-focus t2f-transition', s.navItem)}
            >
              <span aria-hidden="true" className={s.navTile}>
                <Icon name={x.icon} size={18} />
              </span>
              <span className={s.navText}>{t(`nav.${x.id}`)}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className={s.navTitle}>{t('mine')}</p>
      <ul className={s.navList}>
        <li>
          <NextLink href="/passport/" className={cn('t2f-focus t2f-transition', s.navItem)}>
            <span aria-hidden="true" className={s.navTile}>
              <Icon name="passport" size={18} />
            </span>
            <span className={s.navText}>
              {t('passport')}
              <span className={s.navHint}>{stamps}</span>
            </span>
            <Icon name="chevron-right" size={16} className={s.chev} />
          </NextLink>
        </li>
        <li>
          <NextLink href="/schedule/" className={cn('t2f-focus t2f-transition', s.navItem)}>
            <span aria-hidden="true" className={s.navTile}>
              <Icon name="calendar" size={18} />
            </span>
            <span className={s.navText}>{t('schedule')}</span>
            <Icon name="chevron-right" size={16} className={s.chev} />
          </NextLink>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => {
          void authActions.signOut();
          router.push('/');
        }}
        className={cn('t2f-focus t2f-transition', s.signOut)}
      >
        <Icon name="sign-out" size={18} />
        {t('signOut')}
      </button>
    </nav>
  );
}

export function AccountPage() {
  const t = useTranslations('account');
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useHeaderUser();
  const hasPass = useHeaderPass();
  const chatColumn = useChatColumn();
  const overlayOpen = useOverlayOpen();
  const [active, setActive] = useState<SectionId>('profile');
  const [sheet, setSheet] = useState(false);
  const [closing, setClosing] = useState(false);
  // Місце чату макета (`#chat-slot`) для меню кабінету. Шукаємо після вставлення в DOM, до відмальовування
  // (`useLayoutEffect`): під час рендера після переходу з `/login/` макета ще немає в документі, і меню з’являлося
  // лише з наступним рендером — секунди потому (правка власника 2026-11-10).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const signedIn = hydrated && user !== null;
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- вузол макета видно лише після вставлення в DOM
    setSlot(chatColumn && signedIn ? document.getElementById(CHAT_SLOT_ID) : null);
  }, [chatColumn, signedIn]);

  // Гість — на вхід, з поверненням сюди.
  useEffect(() => {
    if (!hydrated || user) return;
    rememberReturn(currentPath());
    router.replace('/login/');
  }, [hydrated, user, router]);

  // Поточний розділ — останній, чий заголовок дійшов до верхньої третини екрана.
  useEffect(() => {
    const on = () => {
      let cur: SectionId = 'profile';
      for (const x of SECTIONS) {
        const el = document.getElementById(x.id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight / 3) cur = x.id;
      }
      setActive(cur);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [user]);

  // До гідратації (і поки гостя переводимо на вхід) — скелетон кабінету, той самий, що в `account/loading.tsx` (2026-11-10).
  if (!hydrated || !user)
    return (
      <div id="content" tabIndex={-1} className="focus:outline-none" data-page="S-ACCOUNT">
        <AccountSkeleton />
      </div>
    );

  const closeSheet = () => {
    setClosing(true);
    window.setTimeout(() => {
      setSheet(false);
      setClosing(false);
    }, CLOSE_MS);
  };
  const activeLabel = t(`nav.${active}`);

  return (
    <div id="content" tabIndex={-1} className={cn(s.page, 'focus:outline-none')} data-page="S-ACCOUNT">
      <h1 className={s.h1}>{t('title')}</h1>
      <p className={s.pageLead}>{t('lead')}</p>
      <div className={s.sections}>
        <ProfileSection hasPass={hasPass} />
        <SettingsSection hasPass={hasPass} />
        <NotificationsSection />
        <DataSection />
      </div>

      {/* Десктоп: меню кабінету на місці чату; коли відкрите вікно (меню з шапки тощо) — на його місці вікно. */}
      {slot && !overlayOpen ? createPortal(<div className={s.navPanel}><CabinetNav active={active} hasPass={hasPass} /></div>, slot) : null}

      {/* Телефон і планшет: чату немає — кнопка розділів закріплена внизу, шторка з тим самим меню. */}
      {!chatColumn ? (
        <>
          <button type="button" onClick={() => setSheet(true)} aria-haspopup="dialog" className={cn('t2f-focus t2f-transition', s.bar)} data-cabinet-bar="">
            <Icon name="menu" size={20} />
            <span className={s.barLabel}>{t('barLabel')}</span>
            <b className={s.barTitle}>{activeLabel}</b>
            <Icon name="chevron-up" size={18} />
          </button>
          <Sheet open={sheet} onOpenChange={(v) => (v ? setSheet(true) : closeSheet())} closing={closing} title={t('navLabel')} boardHeader>
            <div className="px-2 pb-4">
              <CabinetNav active={active} hasPass={hasPass} onPick={closeSheet} />
            </div>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}
