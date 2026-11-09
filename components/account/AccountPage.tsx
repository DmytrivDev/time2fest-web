'use client';

/**
 * Кабінет `/account/` за дошками `Desk-Cabinet-New2` / `Desk-Cabinet-New3` (рішення власника 2026-11-08; пароля немає —
 * вхід посиланням з листа або Google). Ліворуч — один аркуш із розділами «Профіль» (аватар, нік, прапор, плашка пасу, «Як ти
 * входиш»), «Налаштування», «Сповіщення» (заглушка), «Дані й акаунт». Десктоп: праворуч на місці чату — меню кабінету
 * (розділи, «Моє свято», «Вийти»); «☰ Меню» в шапці відкриває звичайне меню на тому ж місці. Телефон: чату немає, кнопка
 * розділів закріплена внизу — шторка. Гість — на вхід (з поверненням сюди).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
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
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { validateNick, type NickIssue } from '@/lib/chat-sim/nick';
import { NICK_MAX } from '@/lib/chat-sim/send';
import { getData } from '@/lib/data/load';
import { isCelebrating } from '@/lib/engine/celebration';
import { IS_TEST_BUILD } from '@/lib/env';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useNow } from '@/lib/time/TimeProvider';
import { useAccountStore } from '@/stores/account';
import { useAuthStore } from '@/stores/auth';
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

/** «UTC+2», «UTC−5», «UTC+5:30». */
function utcLabel(min: number): string {
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
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
  const email = useAuthStore((a) => a.user?.email ?? '');
  const storedNick = useGuestStore((g) => g.nick);
  const storedFlag = useGuestStore((g) => g.flagCode ?? g.detectedFlag);
  const setNickStore = useGuestStore((g) => g.setNick);
  const detected = useMemo(() => useGuestStore.getState().detectedFlag ?? detectFlag(), []);
  const [nick, setNick] = useState(storedNick ?? user.name);
  const [flag, setFlag] = useState(storedFlag ?? detected ?? 'earth');
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
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
          if (issue) return;
          setNickStore(nick.trim(), flag);
          setSaved(true);
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
          <button type="submit" disabled={!dirty} className={cn('t2f-focus t2f-transition', s.btn, s.coral)}>
            {t('profile.save')}
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

function LoginBlock() {
  const t = useTranslations('account.login');
  const router = useRouter();
  const user = useAuthStore((a) => a.user);
  const signOut = useAuthStore((a) => a.signOut);
  const googleLinked = useAccountStore((a) => a.googleLinked);
  const pending = useAccountStore((a) => a.pendingEmail);
  const setAcc = useAccountStore((a) => a.set);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const google = user?.via === 'google';
  const email = user?.email ?? '';

  const send = () => {
    const v = value.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) return setError(t('emailInvalid'));
    if (v === email) return setError(t('emailSame'));
    setAcc('pendingEmail', { email: v, sentAt: Date.now() });
    setEditing(false);
    setValue('');
    setError(null);
  };
  // Тест: «лист відкрито» — пошту змінено.
  const confirm = () => {
    if (!pending) return;
    useAuthStore.setState((a) => ({
      user: a.user ? { ...a.user, email: pending.email } : a.user,
      accounts: a.accounts.map((x) => (x === email ? pending.email : x)),
    }));
    setAcc('pendingEmail', null);
  };
  const connect = () => {
    setConnecting(true);
    window.setTimeout(() => {
      setConnecting(false);
      setAcc('googleLinked', true);
    }, GOOGLE_DELAY_MS);
  };

  return (
    <div className={s.login} data-block="login">
      <h3 className={s.h3}>{t('title')}</h3>
      <p className={s.lead}>{google ? t('noteGoogle') : t('noteEmail')}</p>

      <Row title={t('email')} hint={google ? t('emailGoogle', { email }) : t('emailHint', { email })}>
        {!google && !editing && !pending ? (
          <button type="button" onClick={() => setEditing(true)} className={cn('t2f-focus', s.link)}>
            {t('change')}
          </button>
        ) : null}
      </Row>
      <div className="t2f-reveal" data-open={editing}>
        <div className="t2f-reveal-inner">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              send();
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
              <button type="submit" className={cn('t2f-focus t2f-transition', s.btn, s.coral)}>
                {t('sendConfirm')}
              </button>
              <button type="button" onClick={() => setEditing(false)} className={cn('t2f-focus', s.link)}>
                {t('cancel')}
              </button>
            </div>
          </form>
        </div>
      </div>
      {pending ? (
        <div className={s.notice} role="status">
          <Icon name="at" size={18} />
          <div>
            {t.rich('emailSent', { email: pending.email, b: (x) => <b>{x}</b> })}
            <div className={s.noticeActs}>
              <button type="button" onClick={() => setAcc('pendingEmail', null)} className={cn('t2f-focus', s.link)}>
                {t('cancelChange')}
              </button>
              {IS_TEST_BUILD ? (
                <button type="button" onClick={confirm} className={cn('t2f-focus', s.link)} data-test-confirm-email="">
                  {t('testOpen')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Row title={t('google')} hint={google || googleLinked ? t('googleOn') : connecting ? t('googleConnecting') : t('googleOff')}>
        {google ? (
          <span className={s.ok}>{t('googleLinked')}</span>
        ) : googleLinked ? (
          <span className={s.acts}>
            <span className={s.ok}>{t('googleLinked')}</span>
            <button type="button" onClick={() => setAcc('googleLinked', false)} className={cn('t2f-focus', s.link)}>
              {t('googleDisconnect')}
            </button>
          </span>
        ) : (
          <button type="button" disabled={connecting} onClick={connect} className={cn('t2f-focus t2f-transition', s.btn, s.line)}>
            {connecting ? <span className={s.spin} aria-hidden="true" /> : null}
            {t('googleConnect')}
          </button>
        )}
      </Row>
      <Row title={t('devices')} hint={t('devicesHint')}>
        <button
          type="button"
          onClick={() => {
            signOut();
            router.push('/');
          }}
          className={cn('t2f-focus', s.link)}
        >
          {t('signOutAll')}
        </button>
      </Row>
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
  const found = query.trim()
    ? data.countries.filter((x) => x.name.uk.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [];
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
            placeholder={t('countrySearch')}
            aria-label={t('countrySearch')}
            className="t2f-nk-input"
          />
          {found.length ? (
            <ul className={s.options}>
              {found.map((x) => (
                <li key={x.iso}>
                  <button
                    type="button"
                    onClick={() => {
                      setIso(x.iso);
                      setPicking(false);
                      setQuery('');
                      const z = countryZones(x.iso);
                      acc.set('homeCountry', x.iso);
                      acc.set('homeZoneId', z[0]?.id ?? null);
                    }}
                    className={cn('t2f-focus t2f-transition', s.option)}
                  >
                    <Flag round code={x.flagCode} size="sm" decorative />
                    {x.name.uk}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} className={cn('t2f-focus t2f-transition', s.countryBtn)}>
          {country ? <Flag round code={country.flagCode} size="sm" decorative /> : null}
          <span className={s.countryName}>{country?.name.uk ?? iso}</span>
          <Icon name="chevron-down" size={16} className={s.chev} />
        </button>
      )}
      {zones.length > 1 ? (
        <>
          <div className={s.label} style={{ marginTop: 14 }}>
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
                  acc.set('homeCountry', iso);
                  acc.set('homeZoneId', z.id);
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
            acc.set('homeCountry', null);
            acc.set('homeZoneId', null);
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
  const acc = useAccountStore();
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
            onChange={(v) => acc.set('hour12', v === 'h12')}
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
        <Toggle label={t('showPassport')} hint={t('showPassportHint')} checked={acc.showPassport} onChange={(v) => acc.set('showPassport', v)} />
        <Toggle label={t('showPath')} hint={t('showPathHint')} checked={hasPass && acc.showPath} disabled={!hasPass} onChange={(v) => acc.set('showPath', v)} />
        <Toggle label={t('hints')} hint={t('hintsHint')} checked={acc.passportHints} onChange={(v) => acc.set('passportHints', v)} />
        <Toggle label={t('firstRow')} hint={t('firstRowHint')} checked={!hasPass || !acc.firstRowHidden} disabled={!hasPass} onChange={(v) => acc.set('firstRowHidden', !v)} />
        <Toggle label={t('quiet')} hint={t('quietHint')} checked={hasPass && acc.quietDefault} disabled={!hasPass} onChange={(v) => acc.set('quietDefault', v)} />
        <Toggle label={t('motion')} hint={t('motionHint')} checked={motion} onChange={setMotion} />
      </div>
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
  const email = useAuthStore((a) => a.user?.email ?? '');
  const [confirm, setConfirm] = useState(false);
  const download = () => {
    const guest = useGuestStore.getState();
    const payload = {
      account: { email, via: useAuthStore.getState().user?.via },
      nick: guest.nick,
      flag: guest.flagCode,
      stamps: guest.stamps,
      schedule: guest.schedule,
      hasPass: guest.hasPass,
      settings: Object.fromEntries(Object.entries(useAccountStore.getState()).filter(([, v]) => typeof v !== 'function')),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'time2fest-dani.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const remove = () => {
    useAuthStore.setState((a) => ({ user: null, accounts: a.accounts.filter((x) => x !== email), passes: Object.fromEntries(Object.entries(a.passes).filter(([k]) => k !== email)) }));
    useGuestStore.getState().resetGuest();
    useAccountStore.getState().reset();
    router.push('/');
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
                <button type="button" onClick={remove} className={cn('t2f-focus t2f-transition', s.btn, s.dangerBtn)}>
                  {t('deleteYes')}
                </button>
                <button type="button" onClick={() => setConfirm(false)} className={cn('t2f-focus', s.link)}>
                  {t('deleteNo')}
                </button>
              </div>
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
  const stamps = useGuestStore((g) => g.stamps.length);
  const signOut = useAuthStore((a) => a.signOut);
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
              {x.id === 'notifications' ? <span className={s.soon}>{t('nav.soon')}</span> : null}
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
          signOut();
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

  if (!hydrated || !user) return <div id="content" tabIndex={-1} className={s.page} data-page="S-ACCOUNT" />;

  const closeSheet = () => {
    setClosing(true);
    window.setTimeout(() => {
      setSheet(false);
      setClosing(false);
    }, CLOSE_MS);
  };
  const slot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
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
