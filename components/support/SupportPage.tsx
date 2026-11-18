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
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { Faq } from '@/components/live/Faq';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { ToastBubble } from '@/components/toast/ToastBubble';
import { useAgo } from '@/components/toast/ToastStrip';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useToastSeason } from '@/components/toast/useToastSeason';
import { useWorldToasts } from '@/components/toast/useWorldToasts';
import { useHasPass } from '@/lib/api/hooks/auth';
import type { Ms } from '@/lib/data/types';
import { formatClock, formatTimeForViewer } from '@/lib/i18n/time';
import { stripView, type StripItem } from '@/lib/toast/feed';
import { isToastTier } from '@/lib/toast/tiers';
import { Hero, OpensAt, PassCard, WhatIsToast } from './SupportParts';
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

export function SupportPage() {
  const t = useTranslations('supportPage');
  const tt = useTranslations('toast');
  const season = useToastSeason();
  const hasPass = useHasPass();
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
          {/* «Хочеш більше від свята?» — пропозиція пасу: з пасом (акаунта чи пристрою) її немає. */}
          {hasPass ? null : (
            <PassCard />
          )}
          <Faq items={faq} columns={2} className={s.faq} />
        </>
      ) : null}
      <PageChat />
    </div>
  );
}
