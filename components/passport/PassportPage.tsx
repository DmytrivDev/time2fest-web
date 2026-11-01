'use client';

/**
 * S-PROFILE «Мій паспорт Нових років» `/passport/` — перша версія за дошками `Desk-Passport` / `Phone-Passport`
 * (рішення власника 2026-11-01: «Мій паспорт» у штампі веде сюди; решту сторінки — шлях, мапа, серії, «Поділитися
 * паспортом» — доробимо окремо). Зараз: заголовок і сезон, картка гостя (ім’я, прапор, штампи й країни, вхід, щоб
 * не загубити), «Сторінка 1 · Штампи» — листівки з печаткою (у «Першому ряді» — жовта рамка) і клітинка «Наступний
 * штамп» з найближчою північчю. Під кожним штампом — «Як тобі шоу?»: оцінити чи змінити оцінку можна й постфактум.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useEffect, useState } from 'react';
import { useHeaderUser } from '@/components/auth/session';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { StampArt } from '@/components/windows/StampArt';
import { StampRate } from '@/components/windows/StampRate';
import { getData } from '@/lib/data/load';
import type { Ms, Stamp } from '@/lib/data/types';
import { formatClock, formatShortCountdown } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import s from './passport.module.css';

function stampRow(stamp: Stamp) {
  const data = getData();
  const event = data.eventsById.get(stamp.eventId);
  const country = data.countriesByIso.get(stamp.countryIso);
  const city = event ? data.citiesById.get(event.cityId)?.name.uk : undefined;
  return {
    id: stamp.eventId,
    city: city ?? stamp.cityName,
    country: country?.name.uk ?? '',
    flagCode: country?.flagCode ?? stamp.countryIso,
    illustrationId: country?.illustrationId ?? stamp.illustrationId,
    midnightMs: event?.midnightMs,
    seat: stamp.firstRowSeat,
  };
}

/** Найближча майбутня північ (найпопулярніша подія слота). */
function nextMidnight(now: Ms) {
  const data = getData();
  const future = data.events.filter((e) => e.midnightMs > now);
  if (!future.length) return null;
  const first = Math.min(...future.map((e) => e.midnightMs));
  const event = future.filter((e) => e.midnightMs === first).sort((a, b) => b.popularity - a.popularity)[0]!;
  return { city: data.citiesById.get(event.cityId)?.name.uk ?? '', midnightMs: event.midnightMs };
}

export function PassportPage() {
  const t = useTranslations('passport');
  const tStamp = useTranslations('windows.achievement');
  const now = useNow({ granularity: 'minute' });
  const user = useHeaderUser();
  const stamps = useGuestStore((g) => g.stamps);
  const nick = useGuestStore((g) => g.nick);
  const flagCode = useGuestStore((g) => g.flagCode);
  const ratings = useGuestStore((g) => g.rate);
  const setRate = useGuestStore((g) => g.setRate);
  // Дані гостя — з localStorage: до гідрації не малюємо список, щоб не мигтіло «0 штампів».
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- позначка «клієнт змонтовано»
  useEffect(() => setReady(true), []);

  const rows = ready ? [...stamps].sort((a, b) => a.grantedAt - b.grantedAt).map(stampRow) : [];
  const countries = new Set(rows.map((r) => r.flagCode)).size;
  const next = nextMidnight(now);
  const name = nick || t('guestName');

  return (
    <main id="content" tabIndex={-1} className={cn(s.main, 'focus:outline-none')} data-page="S-PROFILE">
      <header className={s.head}>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.season}>{t('season')}</p>
      </header>

      <section className={s.profile} aria-label={t('profileLabel')}>
        <span aria-hidden="true" className={s.avatar}>
          {name.slice(0, 1).toLocaleUpperCase('uk')}
        </span>
        <div className={s.who}>
          <p className={s.name}>{name}</p>
          {flagCode ? (
            <p className={s.from}>
              <Flag code={flagCode} size="sm" decorative />
              {getData().countriesByIso.get(flagCode)?.name.uk ?? flagCode}
            </p>
          ) : null}
          {!user ? (
            <p className={s.saved}>
              {t.rich('savedLocal', {
                signIn: (chunks) => (
                  <NextLink href="/login/" className="t2f-focus rounded-sm font-semibold text-text underline underline-offset-2">
                    {chunks}
                  </NextLink>
                ),
              })}
            </p>
          ) : null}
        </div>
        <dl className={s.stats}>
          <div className={s.stat}>
            <dd>{rows.length}</dd>
            <dt>{t('stamps', { count: rows.length })}</dt>
          </div>
          <div className={s.stat}>
            <dd>{countries}</dd>
            <dt>{t('countries', { count: countries })}</dt>
          </div>
        </dl>
      </section>

      <section className={s.page} aria-labelledby="passport-page-1">
        <div className={s.pageHead}>
          <h2 id="passport-page-1" className={s.pageTitle}>
            {t('pageStamps')}
          </h2>
          <span className={s.pageYear}>2026/27</span>
        </div>
        {ready && rows.length === 0 ? <p className={s.empty}>{t('empty')}</p> : null}
        <ul className={s.grid}>
          {rows.map((r) => (
            <li key={r.id} className={s.cell} data-first-row={r.seat !== undefined || undefined}>
              <div className={cn(s.card, r.seat !== undefined && s.cardGold)}>
                <StampArt illustrationId={r.illustrationId} stampText={tStamp('stamped', { city: r.city.toLocaleUpperCase('uk') })} />
              </div>
              <p className={s.city}>{r.city}</p>
              <p className={cn(s.meta, r.seat !== undefined && s.metaGold)}>
                {r.seat !== undefined
                  ? t('firstRowSeat', { seat: r.seat })
                  : `${r.country}${r.midnightMs !== undefined ? ` · ${formatClock(r.midnightMs)}` : ''}`}
              </p>
              {/* Оцінку шоу можна поставити чи змінити й постфактум (рішення власника 2026-11-01). */}
              <StampRate
                layout="compact"
                rows={[{ eventId: r.id, city: r.city }]}
                values={ratings[r.id]?.stars !== undefined ? { [r.id]: ratings[r.id]!.stars } : {}}
                onRate={(id, stars) => setRate(id, { stars })}
              />
            </li>
          ))}
          {next ? (
            <li className={s.cell} data-next="">
              <div className={s.nextBox}>
                <Icon name="clock" size={22} className="text-text-secondary" />
                <span className={s.nextCity}>
                  {next.city} · {formatClock(next.midnightMs)}
                </span>
                <span className={s.nextIn}>{t('nextIn', { time: formatShortCountdown(next.midnightMs - now) })}</span>
              </div>
              <p className={s.city}>{t('nextTitle')}</p>
              <p className={s.meta}>{t('nextHint')}</p>
            </li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
