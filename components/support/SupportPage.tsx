'use client';

/**
 * «Тости світу» (`/support/`; було «Підтримати», рішення власника 2026-11-13). Адреса лишилась — старі посилання й
 * `?toast=10` працюють. Сторінка в макеті `(live)` з чатом «Світ» праворуч; перший блок — на рівні верху чату. Дошки для
 * переробки немає — в розкладці й стилі сторінки (колишня дошка `Desk-Support-New`, варіант A). Три стани за правилом
 * тосту (`lib/toast/season`, те саме, що `isCelebrating`):
 * - **свято йде** — героїчний блок «Тости світу»: лічильники, як у смузі («N тостів за свято · M країн»), і «Сказати
 *   тост» (вікно тосту); нижче — УСІ тости свята: закріплені (як у смузі — дорожчі першими, «до HH:MM»), далі решта,
 *   спершу найновіші, порціями «Показати ще». Порожньо — «Тостів ще немає — скажи перший». Пас, «Питання й відповіді».
 * - **до свята** — «Тости відкриються разом зі святом» з датою й часом початку за часом людини, що таке тост, три рівні й
 *   що дає кожен (лише показ, без вибору й оплати), пас, «Питання й відповіді».
 * - **після свята** — архів: тости, сказані за свято (у справжній збірці — справжні; імітовані — лише під
 *   `SIMULATED_TOASTS`), без «Сказати тост», рядок про наступний Новий рік.
 * `/support/?toast=10` (рядок «Скажи тост за $10» на сторінці пасу) — під час свята вікно тосту одразу з $10; поза
 * святом адреса просто очищається (`useOpenToastWindow` поза святом нічого не робить).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { Faq } from '@/components/live/Faq';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { ToastBubble } from '@/components/toast/ToastBubble';
import { useAgo } from '@/components/toast/ToastStrip';
import { ToastTiers, ToastBenefits } from '@/components/toast/ToastTiers';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useToastSeason } from '@/components/toast/useToastSeason';
import { useWorldToasts } from '@/components/toast/useWorldToasts';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { formatClock, formatTimeForViewer } from '@/lib/i18n/time';
import { stripView, type StripItem } from '@/lib/toast/feed';
import { toastsOpenAt, type ToastSeason } from '@/lib/toast/season';
import { isToastTier } from '@/lib/toast/tiers';
import { useNow } from '@/lib/time/TimeProvider';
import s from './support.module.css';

/** Скільки тостів показуємо одразу й додаємо кнопкою «Показати ще». */
export const TOASTS_PAGE = 20;
/** Скільки прапорів біля лічильників. */
const FLAGS = 8;

/** Усі тости свята, що вже прозвучали: закріплені (як у смузі) і решта, спершу найновіші. */
function useAllToasts() {
  const { ready, toasts, now, midnights } = useWorldToasts();
  const view = stripView(toasts, now, midnights, Infinity);
  return { ready, now, view, flags: [...new Set([...toasts].reverse().map((m) => m.flagCode))].slice(0, FLAGS) };
}

function Counters({ total, countries, flags }: { total: number; countries: number; flags: string[] }) {
  const t = useTranslations('supportPage');
  if (!total) return null;
  return (
    <p className={s.counters} data-toast-counters="">
      <span aria-hidden="true" className={s.flags}>
        {flags.map((f) => (
          <Flag key={f} code={f} diameter={18} decorative />
        ))}
      </span>
      <span>{t('toastsMeta', { count: total, countries })}</span>
    </p>
  );
}

/** Час тосту: свято йде — «щойно», «3 хв»; архів — «1 січня, 03:12» за часом людини. */
function useWhen(season: 'during' | 'after') {
  const ago = useAgo();
  return (now: Ms, at: Ms) => {
    if (season === 'during') return ago(now, at);
    const v = formatTimeForViewer(at, { now });
    return v.date ? `${v.date}, ${v.time}` : v.time;
  };
}

function Feed({ season, now, pinned, rest }: { season: 'during' | 'after'; now: Ms; pinned: StripItem[]; rest: StripItem[] }) {
  const t = useTranslations('supportPage');
  const ts = useTranslations('toast.strip');
  const when = useWhen(season);
  const [shown, setShown] = useState(TOASTS_PAGE);
  const firstNew = useRef<HTMLLIElement>(null);
  const [focusFrom, setFocusFrom] = useState<number | null>(null);
  // «Показати ще» — фокус на перший доданий тост, щоб клавіатура не губилась.
  useEffect(() => {
    if (focusFrom !== null) firstNew.current?.focus();
  }, [focusFrom]);
  const left = rest.length - shown;

  if (!pinned.length && !rest.length) {
    return (
      <section aria-labelledby="support-all" className={s.box} data-world-toasts="" data-empty="">
        <h2 id="support-all" className={s.h2}>
          {t('allTitle')}
        </h2>
        <p className={s.empty}>{season === 'during' ? ts('emptyTitle') : t('emptyAfter')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="support-all" className={s.box} data-world-toasts="">
      {pinned.length ? (
        <>
          <p className={s.label}>{ts('pinnedTitle')}</p>
          <ul className={s.feed} data-toast-list="pinned">
            {pinned.map(({ toast, until }) => (
              <li key={toast.id}>
                <ToastBubble
                  nick={toast.nick}
                  flagCode={toast.flagCode}
                  text={toast.text}
                  tier={toast.tier}
                  pass={!!toast.pass}
                  meta
                  aside={until ? ts('pinnedShort', { time: formatClock(until) }) : undefined}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className={cn(s.boxHead, pinned.length > 0 && s.boxHeadGap)}>
        <h2 id="support-all" className={s.h2}>
          {t('allTitle')}
        </h2>
        <span className={s.meta}>{t('allSub')}</span>
      </div>
      <ul className={s.feed} data-toast-list="all">
        {rest.slice(0, shown).map(({ toast }, i) => (
          <li key={toast.id} ref={i === focusFrom ? firstNew : undefined} tabIndex={i === focusFrom ? -1 : undefined} className="focus:outline-none">
            <ToastBubble nick={toast.nick} flagCode={toast.flagCode} text={toast.text} tier={toast.tier} pass={!!toast.pass} aside={when(now, toast.createdAt)} />
          </li>
        ))}
      </ul>
      {left > 0 ? (
        <button
          type="button"
          onClick={() => {
            setFocusFrom(shown);
            setShown((v) => v + TOASTS_PAGE);
          }}
          className={cn('t2f-focus t2f-press', s.more)}
          data-action="toasts-more"
        >
          {t('more', { count: left })}
          <Icon name="chevron-down" size={16} />
        </button>
      ) : null}
    </section>
  );
}

/** До свята: коли тости відкриються — дата й час за часом людини. */
function OpensAt() {
  const t = useTranslations('supportPage');
  const now = useNow({ granularity: 'minute' });
  const at = toastsOpenAt(getData());
  if (at === null) return null;
  const v = formatTimeForViewer(at, { now });
  return (
    <div className={s.opens} data-toasts-open="">
      <span aria-hidden="true" className={s.opensIcon}>
        <Icon name="clock" size={20} />
      </span>
      <div className={s.opensBody}>
        <p className={s.opensTitle}>{t('openTitle')}</p>
        <p className={s.opensWhen}>
          {t.rich('openWhen', { date: v.date ?? t('today'), time: v.time, b: (c: ReactNode) => <b className={s.opensTime}>{c}</b> })}
        </p>
        <p className={s.opensNote}>{t('openNote')}</p>
      </div>
    </div>
  );
}

/** До свята: що таке тост і три рівні — лише показ, без вибору й оплати. */
function WhatIsToast() {
  const t = useTranslations('supportPage');
  return (
    <section aria-labelledby="support-what" className={s.box} data-toast-about="">
      <h2 id="support-what" className={s.h2}>
        {t('whatTitle')}
      </h2>
      <p className={s.sub}>{t('whatText')}</p>
      <p className={cn(s.label, s.labelGap)}>{t('tiersTitle')}</p>
      <div className={s.offerGrid}>
        <ToastTiers />
        <ToastBenefits hasPass={false} readOnly />
      </div>
    </section>
  );
}

function Hero({ season, children }: { season: ToastSeason | null; children?: ReactNode }) {
  const t = useTranslations('supportPage');
  const kicker = season === 'before' ? t('kickerBefore') : season === 'after' ? t('kickerAfter') : season === 'during' ? t('kickerDuring') : null;
  const lead = season === 'before' ? t('leadBefore') : season === 'after' ? t('leadAfter') : season === 'during' ? t('leadDuring') : null;
  return (
    <header className={s.hero}>
      <div aria-hidden="true" className={s.art}>
        <span className={cn(s.artBubble, s.artBack)}>
          <span className={s.who}>
            <Flag code="JP" size="xs" decorative />
            <b>Hiro</b>
            <span className="t2f-toast-badge">тост</span>
          </span>
          Happy New Year з Токіо!
        </span>
        <span className={cn(s.artBubble, s.artFront)}>
          <span className={s.who}>
            <Flag code="UA" size="xs" decorative />
            <b>Олена</b>
            <span className="t2f-toast-badge">тост</span>
          </span>
          <span>
            <EmojiText text="🥂 Піднімаю келих за всіх, хто зустрічає Новий рік разом!" />
          </span>
        </span>
        <span className={s.artGlass}>
          <Emoji char="🥂" size={48} />
        </span>
      </div>
      <div className={s.heroText}>
        {kicker ? (
          <p className={s.kicker}>
            <Icon name="glass" size={14} />
            {kicker}
          </p>
        ) : null}
        <h1 className={s.h1}>{t('title')}</h1>
        {lead ? <p className={s.lead}>{lead}</p> : null}
        {children}
      </div>
    </header>
  );
}

export function SupportPage() {
  const t = useTranslations('supportPage');
  const tt = useTranslations('toast');
  const season = useToastSeason();
  const openToast = useOpenToastWindow();
  const { ready, now, view, flags } = useAllToasts();
  const faq = (['subscription', 'pass', 'refund', 'check'] as const).map((k) => ({ id: k, question: t(`faq.${k}Q`), answer: t(`faq.${k}A`) }));
  // «Скажи тост за $10» зі сторінки пасу: під час свята — вікно з $10 одразу; адресу — чисту в будь-якому разі.
  useEffect(() => {
    if (season === null) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('toast')) return;
    const tier = Number(params.get('toast'));
    params.delete('toast');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    openToast({ tier: isToastTier(tier) ? tier : undefined });
  }, [openToast, season]);

  const live = season === 'during' || season === 'after';
  return (
    <div id="content" tabIndex={-1} className={cn(s.page, 'focus:outline-none')} data-page="S-SUPPORT" data-season={season ?? undefined}>
      <Hero season={season}>
        {live && ready ? <Counters total={view.total} countries={view.countries} flags={flags} /> : null}
        {season === 'during' ? (
          <Button variant="coral" size="lg" iconLeft="glass" yieldToCoralWindow onClick={() => openToast()} className={s.heroBtn} data-action="support-toast">
            {tt('action')}
          </Button>
        ) : null}
        {season === 'before' ? <OpensAt /> : null}
      </Hero>

      {season === 'before' ? <WhatIsToast /> : null}
      {live && ready ? <Feed season={season} now={now} pinned={view.pinned} rest={view.latest} /> : null}

      {season === 'before' || season === 'during' ? (
        <>
          <NextLink href="/pass/" className={cn('t2f-focus', s.passCard)}>
            <span aria-hidden="true" className={s.passIcon}>
              <Icon name="ticket" size={18} />
            </span>
            <span className={s.passText}>
              <b>{t('passTitle')}</b>
              <span>{t('passText')}</span>
            </span>
            <span className={s.passLink}>
              {t('passLink')}
              <Icon name="chevron-right" size={14} />
            </span>
          </NextLink>
          <Faq items={faq} columns={2} className={s.faq} />
        </>
      ) : null}
      <PageChat />
    </div>
  );
}
