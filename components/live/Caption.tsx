'use client';

/**
 * Підпис під плеєром (C1: CaptionRow1–3) — три рядки за фазою з `lib/engine/captionPhase`:
 * 1) позначка «Наживо» + таймер («до півночі 00:22:15» / «далі через 0:59»; після моменту таймера немає);
 * 2) назва події-посилання «Лондон · Біг-Бен ›» (на сторінку країни);
 * 3) «Велика Британія · північ о 02:00 за вашим часом» → «Велика Британія зустріла Новий рік» (`metPhrase`, рід країни)
 *    → «Далі: Азорські острови».
 * Нових смуг між фазами немає: змінюються лише таймер і рядок 3. Назви — лише в називному відмінку.
 * Остання хвилина до півночі зі штампом (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header`, 2026-11-12): десктоп — у рядку 1
 * замість «Зараз дивляться…» золота підказка «Будь тут опівночі — отримаєш штамп: Франція»; телефон — у рядку під відео
 * два рядки «Будь тут опівночі —» / «отримаєш штамп: Франція» і відлік праворуч. Опівночі підказка зникає.
 * Той самий рядок (рішення власника 2026-11-13): людина сама обрала іншу трансляцію поясу, а головне святкування почалось —
 * «Головне святкування почалось · Перемкнути» (`notice`). Десктоп — у рядку 1 на місці «Зараз дивляться…»; телефон — два
 * рядки «Головне святкування» / «почалось · Перемкнути» в рядку часу тієї самої висоти, увесь блок — одна кнопка.
 */
import NextLink from 'next/link';
import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import type { City, Country, Ms } from '@/lib/data/types';
import type { CaptionMode, CaptionPhase } from '@/lib/engine/captionPhase';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatAgo, formatClock, formatCountdown, formatShortCountdown } from '@/lib/i18n/time';
import { Icon } from '@/components/primitives/Icon';
import { Tooltip } from '@/components/primitives/Tooltip';
import home from './home.module.css';

export interface CaptionPlace {
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  city: Pick<City, 'name' | 'landmark'> | undefined;
  country: Pick<Country, 'name' | 'gender'> & Partial<Pick<Country, 'flagCode'>> | undefined;
  /** Сторінка країни. */
  href: string | null;
}

export interface CaptionProps {
  phase: CaptionPhase;
  current: CaptionPlace;
  next?: CaptionPlace | null;
  /** Позначка «Наживо» (є відео в ефірі). */
  live?: boolean;
  /** «Перевірено» (десктоп): джерело перевірене власником. */
  verified?: boolean;
  /** Часовий пояс глядача (тести, історії); типово — пояс браузера. */
  timeZone?: string;
  /** id заголовка блоку плеєра (сюди повертається фокус після закриття вікон). */
  titleId?: string;
  /**
   * `remote` — сторінка країни (пульт): сама не переходить; після півночі «Запис» і «північ була 40 хв тому»
   * на місці таймера, рядок 3 — «Франція зустріла Новий рік · далі: Велика Британія о 02:00».
   */
  mode?: CaptionMode;
  /** Назва рядка 2 замість «Місто · пам’ятка» (пульт: назва вибраної трансляції). */
  title?: string;
  /** «Зараз дивляться люди з N країн» (рядок 1, від 768 px). */
  watchers?: number;
  /** Остання хвилина до півночі зі штампом: країна для підказки «Будь тут опівночі — отримаєш штамп: …». */
  stampHint?: string | null;
  /** «Головне святкування почалось · Перемкнути» (2026-11-13); підказка про штамп старша — сторінка не передає обидва. */
  notice?: { place: string; onSwitch(): void } | null;
  /** Від 768 px праворуч від таймера (`Desk-Cookies-Wide`: «Показати чат», коли чат сховано). */
  aside?: ReactNode;
  /** `bar` — один рядок над вкладкою «Чат» на телефоні (`Phone-Chat`); `lead` — що стоїть ліворуч (кнопка звуку). */
  variant?: 'full' | 'bar' | 'title';
  lead?: ReactNode;
  /** Рядок 3 для зчитувача в `bar` (вимкнено, коли блок назви з тим самим рядком стоїть поруч). */
  srRow3?: boolean;
  className?: string;
}

/** Остання хвилина до півночі, поки йде відео: цифри розмиті (відео відстає — нуль таймера випередив би північ на відео). */
const BLUR_FROM_MS = 60_000;

/**
 * Цифри таймера. Коли `veiled` — розмиті, поверх них пігулка «Показати», і підказка про затримку відео (правка власника
 * 2026-10-31: лише коли трансляція справді йде; відлік без відео не розмивається). Натискання показує таймер до кінця події.
 */
function TimerDigits({ digits, veiled, className, hint }: { digits: string; veiled: boolean; className?: string; hint: boolean }) {
  const t = useTranslations('player');
  const [shown, setShown] = useState(false);
  const plain = (
    <span aria-hidden="true" className={className}>
      {digits}
    </span>
  );
  if (!veiled) return plain;
  // Після натискання підказка гасне (правка власника 2026-10-31).
  return (
    <span className={home.veilWrap}>
      {shown ? (
        // та сама будова, що й у кнопки, — інакше висота рядка міняється на пару пікселів
        <span className={home.veilBtn}>
          <span aria-hidden="true" className={cn(className, home.veiled, home.unveiled)}>
            {digits}
          </span>
        </span>
      ) : (
        // ліворуч від таймера: видно без прокрутки й ніколи не лягає на відео (ІНВ 5.6, правила YouTube)
        <Tooltip content={t('timerVeilTip')} side="left" align="start" avoidCollisions={false}>
          <button type="button" aria-label={t('timerReveal')} data-timer-veiled="" onClick={() => setShown(true)} className={cn('t2f-focus', home.veilBtn)}>
            <span aria-hidden="true" className={cn(className, home.veiled)}>
              {digits}
            </span>
          </button>
        </Tooltip>
      )}
      {hint ? (
        <span aria-hidden="true" data-veil-hint={shown ? 'gone' : 'on'} className={cn(home.veilHint, shown && home.veilHintGone)}>
          <span className={home.veilPill}>
            <Icon name="eye" size={14} />
            {t('timerVeilHint')}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** «Лондон · Біг-Бен» або просто «Азорські острови». */
export function eventTitle(city: CaptionPlace['city']): string {
  if (!city) return '';
  return city.landmark?.uk ? `${city.name.uk} · ${city.landmark.uk}` : city.name.uk;
}

function useSpoken() {
  const t = useTranslations('primitives.countdown');
  const tp = useTranslations('player');
  return (ms: number) => {
    const totalSec = Math.max(0, Math.ceil(ms / 1_000));
    if (totalSec === 0) return t('spokenZero');
    // Остання хвилина — секундами; далі — до хвилини вгору (зчитувач не читає щосекунди: `role="timer"` без live).
    if (totalSec < 60) return tp('secondsSpoken', { seconds: totalSec });
    const totalMinutes = Math.ceil(totalSec / 60);
    return t('spoken', {
      days: Math.floor(totalMinutes / 1440),
      hours: Math.floor((totalMinutes % 1440) / 60),
      minutes: totalMinutes % 60,
    });
  };
}

export function Caption({
  phase,
  current,
  next,
  live = false,
  verified = false,
  timeZone,
  titleId,
  mode = 'broadcast',
  title: titleProp,
  watchers,
  stampHint = null,
  notice = null,
  aside,
  variant = 'full',
  lead,
  srRow3 = true,
  className,
}: CaptionProps) {
  const t = useTranslations('player');
  const tc = useTranslations('country.caption');
  const tMet = useTranslations('met');
  const tBadge = useTranslations('primitives.badge');
  const spoken = useSpoken();

  const r1 = phase.row1Right;
  const timer =
    r1.kind === 'countdown' || r1.kind === 'handover'
      ? {
          label: r1.kind === 'countdown' ? t('timerUntil') : t('timerNext'),
          digits: r1.kind === 'countdown' ? formatCountdown(r1.ms) : formatShortCountdown(r1.ms),
          ms: r1.ms,
        }
      : null;

  // Розмиття — лише відлік до півночі, поки грає відео; ключ — північ події (нова подія — знову розмито).
  const veiled = live && r1.kind === 'countdown' && r1.ms > 0 && r1.ms <= BLUR_FROM_MS;
  const veilKey = current.midnightMs;
  const ago = r1.kind === 'ago' ? r1.ms : null;
  const tzOpts = timeZone ? { timeZone } : {};

  const countryName = current.country?.name.uk ?? '';
  let row3: string;
  switch (phase.row3.kind) {
    case 'midnight-at':
      row3 = t('lineBefore', { country: countryName, time: formatClock(current.midnightMs, tzOpts) });
      break;
    case 'met':
    case 'met-and-next': {
      if (!current.country) {
        row3 = '';
        break;
      }
      const p = metPhrase(current.country);
      row3 = p.kind === 'single' ? tMet('single', p.params) : p.kind === 'multi' ? tMet('multi', { names: joinNamesUk(p.params.names) }) : tMet('fallback', p.params);
      if (phase.row3.kind === 'met-and-next' && next) {
        const place = next.country?.name.uk ?? next.city?.name.uk ?? '';
        row3 = tc('metAndNext', { met: row3, place, time: formatClock(next.midnightMs, tzOpts) });
      }
      break;
    }
    case 'next':
      row3 = t('lineNext', { place: next?.city?.name.uk ?? '' });
      break;
  }

  const title = titleProp ?? eventTitle(current.city);
  // Прапор країни перед назвою трансляції (правка власника 2026-11-05): видно, де саме йде трансляція; висоту рядка не змінює.
  const flag = current.country?.flagCode ? (
    <span className={home.titleFlag}>
      <Flag round code={current.country.flagCode} size="md" decorative />
    </span>
  ) : null;
  // Пульт: ми вже на сторінці країни — назва не посилання.
  const href = mode === 'remote' ? null : current.href;

  // Телефон, вкладка «Чат» (`Phone-Chat`): один рядок 48 px — звук · «Лондон · до півночі 00:22:15» · «Наживо».
  if (variant === 'bar') {
    // Підказка про штамп чи «Головне святкування почалось» займає місце назви: висота рядка та сама.
    const hinted = !!stampHint || !!notice;
    return (
      <div data-caption="" data-phase={phase.id} data-caption-variant="bar" className={cn(home.bar, className)}>
        {lead}
        {stampHint ? (
          // Підказка двома рядками на місці «Париж · до півночі»; назва лишається для зчитувача.
          <p data-stamp-hint="" className={home.barHint}>
            <span className={home.barHintLead}>{t('stampHintLead')}</span>{' '}
            <span className={home.barHintTail}>{t('stampHintTail', { country: stampHint })}</span>
          </p>
        ) : notice ? (
          // Увесь блок двох рядків — одна кнопка на всю висоту рядка (ціль ≥ 44 px), назва лишається для зчитувача.
          <button type="button" data-main-live="" onClick={notice.onSwitch} className={cn('t2f-focus t2f-press', home.barHint, home.barNotice)}>
            <span className={home.barHintLead}>{t('mainLiveLead')}</span>
            <span className={home.barHintTail}>
              {t('mainLiveTail')} <span aria-hidden="true">›</span>
            </span>
          </button>
        ) : null}
        <div className={cn(home.barText, hinted && home.barTextHint)}>
          <h2 id={titleId} tabIndex={-1} className={cn(home.barTitle, hinted && 'sr-only', 'focus:outline-none')}>
            {current.country?.flagCode ? (
              <span className={home.titleFlag}>
                <Flag round code={current.country.flagCode} size="sm" decorative />
              </span>
            ) : null}
            {/* Місто тієї трансляції, що грає («Гамбург · порт» → «Гамбург»), інакше місто події. */}
            {(titleProp ? titleProp.split(' · ')[0] : undefined) || current.city?.name.uk || title} <span className={home.barDot}>·</span>
          </h2>
          {timer ? (
            // Цифри не стискаються ніколи: на вузькому рядку першим скорочується підпис «до півночі», потім назва
            // міста (перевірка сайту 2026-11-09, B01). Обгортка `display: contents` — підпис і цифри лишаються одним
            // таймером для тестів і зчитувача, а в рядку стоять окремими елементами.
            <span role="timer" aria-live="off" aria-label={`${timer.label}: ${veiled ? t('timerVeilSpoken') : spoken(timer.ms)}`} data-caption-timer={r1.kind} className={home.barTimerWrap}>
              <span aria-hidden="true" className={cn(home.barLabel, hinted && 'sr-only')}>
                {timer.label}
              </span>
              <span className={home.barClock}>
                <TimerDigits key={veilKey} digits={timer.digits} veiled={veiled} className={cn(home.barDigits, stampHint && home.barDigitsHint)} hint={false} />
              </span>
            </span>
          ) : (
            <span aria-hidden="true" className={home.barTimer}>
              {row3}
            </span>
          )}
        </div>
        {/* Рядок 3 лишається для зчитувача (і подій ефіру), навіть коли видно таймер. */}
        {srRow3 ? (
          <p data-caption-row3={phase.row3.kind} role={phase.row3.kind === 'next' ? 'status' : undefined} className="sr-only">
            {row3}
          </p>
        ) : null}
        {/* Планшет-портрет (`Tab-P-New`): «Дивляться люди з 140 країн» праворуч у рядку; на телефоні сховано CSS. */}
        {watchers && !hinted ? (
          <span aria-hidden="true" data-bar-watchers="" className={home.barWatchers}>
            <Icon name="globe" size={14} strokeWidth={2} />
            {t('watchersShort', { count: watchers })}
          </span>
        ) : null}
        {/* Підказка займає місце позначки «Наживо» (дошка `Phone-Stamp-Header`, кадр 1). */}
        {live && ago === null && !hinted ? (
          <Badge variant="live" still>
            {tBadge('live')}
          </Badge>
        ) : null}
      </div>
    );
  }

  const titleOnly = variant === 'title';
  return (
    <div data-caption={titleOnly ? 'title' : ''} data-phase={phase.id} className={cn(home.caption, titleOnly && home.captionTitleOnly, className)}>
      {titleOnly ? null : <div className={home.badges}>
        {live && ago === null ? (
          <Badge variant="live" still>
            {tBadge('live')}
          </Badge>
        ) : null}
        {/* «Запис» — лише коли відео є; без трансляції після півночі позначки немає (сцена відліку — не запис). */}
        {ago !== null && live ? (
          <span data-caption-recording="" className="inline-flex">
            <Badge variant="recording">{tc('recording')}</Badge>
          </span>
        ) : null}
        {verified ? (
          <span className={cn(home.badgeItem, home.deskItem)}>
            <Icon name="check" size={14} strokeWidth={2.2} />
            {tBadge('verifiedShort')}
          </span>
        ) : null}
        {stampHint ? (
          <span data-stamp-hint="" className={cn(home.badgeItem, home.deskItem, home.stampHint)}>
            <Icon name="stamp" size={16} strokeWidth={2} />
            {t('stampHint', { country: stampHint })}
          </span>
        ) : notice ? (
          <span data-main-live="" className={cn(home.badgeItem, home.deskItem, home.stampHint)}>
            <Icon name="broadcast-live" size={16} strokeWidth={2} />
            {t('mainLive')}
            <span aria-hidden="true">·</span>
            <button type="button" onClick={notice.onSwitch} className={cn('t2f-focus t2f-press', home.noticeBtn)}>
              {t('mainLiveSwitch')}
            </button>
          </span>
        ) : watchers ? (
          <span className={cn(home.badgeItem, home.deskItem)}>
            <Icon name="globe" size={14} strokeWidth={2} />
            {t('watchersFrom', { count: watchers })}
          </span>
        ) : null}
        {phase.flags.delayNotice ? <span>{t('delayNote')}</span> : null}
      </div>}
      <h2 id={titleId} tabIndex={-1} className={cn(home.title, 'focus:outline-none')}>
        {href ? (
          <NextLink href={href} className="t2f-focus t2f-transition rounded-sm">
            {flag}
            {title}
            <span aria-hidden="true" className="text-text-secondary">
              {' ›'}
            </span>
          </NextLink>
        ) : (
          <>
            {flag}
            {title}
          </>
        )}
      </h2>
      <p data-caption-row3={phase.row3.kind} role={phase.row3.kind === 'next' ? 'status' : undefined}
        className={cn(home.sub, (phase.row3.kind === 'met' || phase.row3.kind === 'met-and-next') && home.subMet)}
      >
        {phase.row3.kind === 'next' ? (
          <>
            {t('lineNextLabel')} <strong className="font-semibold text-text">{next?.city?.name.uk ?? ''}</strong>
          </>
        ) : (
          row3
        )}
      </p>
      {timer && !titleOnly ? (
        <span role="timer" aria-live="off" aria-label={`${timer.label}: ${veiled ? t('timerVeilSpoken') : spoken(timer.ms)}`} data-caption-timer={r1.kind} className={home.timer}>
          <span aria-hidden="true" className={home.timerLabel}>
            {timer.label}
          </span>{' '}
          <TimerDigits key={veilKey} digits={timer.digits} veiled={veiled} className={home.timerDigits} hint />
        </span>
      ) : null}
      {ago !== null && !titleOnly ? (
        <span data-caption-ago="" className={home.ago}>
          {tc('ago', { ago: formatAgo(ago) })}
        </span>
      ) : null}
      {aside && !titleOnly ? <div className={home.aside}>{aside}</div> : null}
    </div>
  );
}
