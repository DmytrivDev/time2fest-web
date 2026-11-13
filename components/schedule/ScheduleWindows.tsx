'use client';

/**
 * Вікна «Мого графіка» на місці чату (телефон — шторкою), рішення власника 2026-11-06, дошки `Desk-Schedule-New` v4:
 * - «Країни поясу» (`ZoneCountriesPanel`): пошук у поясі (від 6 країн), групи «Наживо · Головне святкування очікується ·
 *   Вебкамера · Лише відлік», у групі — за абеткою; картки — як «Поточні трансляції»;
 * - «Замінити в графіку?» (`ScheduleReplaceContent`): «Додаєш» — та сама картка без календарика; нижче країни поясу з
 *   графіка рядками (прапор, назва до двох рядків, стан) і «Замінити»; «Скасувати».
 */
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { scheduleClosed } from '@/components/live/CalendarButton';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';
import { fold, getSearchIndex, matchesCityName, matchesCountryName } from '@/lib/search/countrySearch';
import { scheduledCountries, zoneCountryIsos, zoneSlotCount } from '@/lib/schedule/countryZone';
import { GROUP_ORDER, scheduleCountry, type CountryGroup, type ScheduleCountry } from '@/lib/schedule/scheduleCountry';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { ScheduleCountryCard } from './ScheduleCountryCard';
import s from './schedule.module.css';

/** З якої кількості країн у поясі показуємо пошук. */
const SEARCH_FROM = 6;

/** Країни поясу зі станом (`now` — хвилинний). */
export function useZoneCountries(zoneId: string): ScheduleCountry[] {
  const now = useNow({ granularity: 'minute' });
  return useMemo(() => {
    const data = getData();
    return zoneCountryIsos(zoneId, data)
      .map((iso) => scheduleCountry(data, iso, zoneId, now))
      .filter((c): c is ScheduleCountry => c !== null);
  }, [zoneId, now]);
}

/** Чи країна поясу в графіку. */
export function countryInSchedule(schedule: readonly string[], zoneId: string, iso: string): boolean {
  const data = getData();
  return schedule.some((id) => {
    const e = data.eventsById.get(id);
    return !!e && e.zoneId === zoneId && e.countryIso === iso;
  });
}

/** Підзаголовок вікна поясу: «У графіку 2 з 4 · клік по картці — сторінка країни» (оновлюється разом із графіком). */
export function ZoneCountriesSub({ zoneId }: { zoneId: string }) {
  const t = useTranslations('schedulePage.zone');
  const schedule = useGuestStore((g) => g.schedule);
  return <>{t('sub', { count: scheduledCountries(schedule, zoneId).length, limit: zoneSlotCount(zoneId) })}</>;
}

export function ZoneCountriesPanel({ zoneId, onToggle }: { zoneId: string; onToggle(eventId: string): void }) {
  const t = useTranslations('schedulePage.zone');
  const now = useNow();
  const schedule = useGuestStore((g) => g.schedule);
  const countries = useZoneCountries(zoneId);
  const [query, setQuery] = useState('');
  const searchId = useId();
  // Пошук усіма мовами сайту (рішення 2026-11-09): назва країни uk/en/es/fr, місто чи пам’ятка — і латиницею.
  const q = fold(query);
  const shown = q
    ? countries.filter((c) => matchesCountryName(c.iso, c.name, q) || matchesCityName(getSearchIndex(getData()), c.place, q))
    : countries;
  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: shown.filter((c) => c.group === g).sort((a, b) => a.name.localeCompare(b.name, 'uk')),
  })).filter((x) => x.items.length > 0);
  const closed = countries[0] ? scheduleClosed(countries[0].midnightMs, now) : null;
  const label: Record<CountryGroup, string> = { live: t('live'), main: t('main'), webcam: t('webcam'), countdown: t('countdown') };
  return (
    <div className={s.panel} data-schedule-zone={zoneId}>
      {countries.length >= SEARCH_FROM ? (
        <div className={s.search}>
          <Icon name="search" size={16} className="text-text-muted" />
          <label htmlFor={searchId} className="sr-only">
            {t('search')}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder={t('search')}
            onChange={(e) => setQuery(e.target.value)}
            className={s.searchInput}
          />
        </div>
      ) : null}
      {closed ? <p className={s.panelNote}>{t('closed')}</p> : null}
      {groups.length === 0 ? <p className={s.panelNote}>{t('none')}</p> : null}
      {groups.map(({ g, items }) => (
        <section key={g} aria-label={label[g]} className={s.group}>
          <h3 className={s.groupTitle}>
            {label[g]} · {items.length}
          </h3>
          <ul className={s.cards}>
            {items.map((c) => (
              <ScheduleCountryCard
                key={c.iso}
                c={c}
                inSchedule={countryInSchedule(schedule, zoneId, c.iso)}
                closed={closed}
                onToggle={() => onToggle(c.eventId)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** «Замінити в графіку?»: що додаємо й кого замінити. */
export function ScheduleReplaceContent({
  eventId,
  onReplace,
  onCancel,
}: {
  eventId: string;
  onReplace(outIso: string): void;
  onCancel(): void;
}) {
  const t = useTranslations('schedulePage');
  const tw = useTranslations('schedulePage.replaceWin');
  const tType = useTranslations('liveCards.eventCard.type');
  const tZone = useTranslations('schedulePage.zone');
  const locale = useLocale();
  const event = getData().eventsById.get(eventId);
  const zoneId = event?.zoneId ?? '';
  const schedule = useGuestStore((g) => g.schedule);
  const countries = useZoneCountries(zoneId);
  const adding = countries.find((c) => c.iso === event?.countryIso);
  const inZone = scheduledCountries(schedule, zoneId)
    .map((iso) => countries.find((c) => c.iso === iso))
    .filter((c): c is ScheduleCountry => !!c);
  const stateOf = (c: ScheduleCountry) =>
    c.group === 'live' ? tZone('live') : c.group === 'main' ? tType('main') : c.group === 'webcam' ? tType('webcam') : tType('countdownOnly');
  return (
    <div className={s.panel} data-schedule-replace={eventId}>
      {adding ? (
        <>
          <p className={s.panelLabel}>{tw('adding')}</p>
          <ul className={s.cards}>
            <ScheduleCountryCard c={adding} inSchedule={false} closed={null} adding />
          </ul>
        </>
      ) : null}
      <p className={s.panelLabel}>
        {tw('inSchedule', { time: event ? formatClock(event.midnightMs, { locale }) : '' })} · {tw('orSlot')}
      </p>
      <ul className={s.replaceList}>
        {inZone.map((c) => (
          <li key={c.iso} className={s.replaceRow} data-replace-country={c.iso}>
            <Flag code={c.flagCode} diameter={22} decorative />
            <span className={s.replaceText}>
              <b>{c.name}</b>
              <span className={s.replaceState}>
                <Icon name={c.group === 'countdown' ? 'clock' : c.group === 'live' ? 'broadcast-live' : 'broadcast'} size={14} />
                {stateOf(c)}
              </span>
            </span>
            <button
              type="button"
              aria-label={t('replaceAria', { country: c.name })}
              onClick={() => onReplace(c.iso)}
              className={cn('t2f-focus t2f-press', s.replaceBtn)}
            >
              <Icon name="swap" size={16} />
              {t('replace')}
            </button>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onCancel} className="w-full">
        {tw('cancel')}
      </Button>
    </div>
  );
}
