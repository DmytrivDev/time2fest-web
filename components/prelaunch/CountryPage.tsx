'use client';

/**
 * Сторінка країни мовного дерева — інформаційний вигляд без плеєра й чату, у двох станах:
 *   «описано»      — факти + розповідь «Як країна зустрічає Новий рік» і традиції (`data-state="story"`);
 *   «лише факти»   — прапор, північ за часом відвідувача, відлік, пояси (`data-state="facts"`); без заглушки
 *                    «збираємо розповідь» і без вигаданих традицій.
 * Усе про одне місце — головне місто країни (`data/prelaunch/countries.json`).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest, useClientReady } from '@/components/prefest/PrefestContext';
import { MediaSlot } from '@/components/prefest/SceneCanvas';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { Bar } from '@/components/skeleton/parts';
import p from '@/components/prefest/prefest.module.css';
import { clock, dayMonth, utcLabel } from '@/lib/prefest/format';
import { downloadIcs } from '@/lib/prefest/ics';
import { byPreference } from '@/lib/prefest/model';
import { PAGES } from '@/lib/prelaunch/href';
import { SEASON_VALUES } from '@/lib/prelaunch/season';
import { COUNTRY_EXTRAS, type SiteData } from '@/lib/prelaunch/site';
import { useNow } from '@/lib/time/TimeProvider';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

const TRADITION_ICON: Record<string, IconName> = {
  countdown: 'clock',
  clock: 'clock',
  feast: 'utensils',
  food: 'utensils',
  noodles: 'utensils',
  fireworks: 'sparkles',
  lights: 'sparkles',
  ball: 'sparkles',
  kiss: 'heart',
  bell: 'bell',
  mistletoe: 'mistletoe',
  camp: 'moon',
};

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
/** Скільки країн того ж поясу показати посиланнями. */
const NEIGHBORS = 12;

function Body({ iso }: { iso: string }) {
  const t = useTranslations('prelaunch.country');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const now = useNow();
  const country = model.countriesByIso.get(iso);
  if (!country || !site) return null;

  const main = country.main ?? country.zones[0];
  const zone = model.zonesById.get(main?.zoneId ?? '');
  if (!zone) return null;
  const ms = zone.midnightMs;
  const known = ready && now > 0;
  const secs = Math.max(0, Math.floor((ms - now) / 1000));
  const passed = known && ms <= now;
  const units = [
    { key: 'days' as const, n: Math.floor(secs / 86400), text: String(Math.floor(secs / 86400)) },
    {
      key: 'hours' as const,
      n: Math.floor((secs % 86400) / 3600),
      text: pad(Math.floor((secs % 86400) / 3600)),
    },
    {
      key: 'minutes' as const,
      n: Math.floor((secs % 3600) / 60),
      text: pad(Math.floor((secs % 3600) / 60)),
    },
    { key: 'seconds' as const, n: secs % 60, text: pad(secs % 60) },
  ];
  const total = model.zones.length;
  const neighbors = zone.countries
    .filter((x) => x !== iso)
    .map((x) => model.countriesByIso.get(x))
    .filter((x) => x !== undefined)
    .sort(byPreference)
    .slice(0, NEIGHBORS);
  const slug = COUNTRY_EXTRAS[iso]?.urlSlug ?? iso.toLowerCase();

  return (
    <article data-state={country.described ? 'story' : 'facts'}>
      <div className={cn(p.wrap, s.head)}>
        <nav aria-label={t('breadcrumbLabel')}>
          <ol className={s.crumbs}>
            <li>
              <NextLink href={site.href(PAGES.home)}>{t('breadcrumbHome')}</NextLink>
            </li>
            <li>
              <NextLink href={site.href(PAGES.countries)}>{t('breadcrumbCountries')}</NextLink>
            </li>
            <li aria-current="page">{country.name}</li>
          </ol>
        </nav>
        <div className={s.h1Row}>
          <Flag code={country.flagCode} diameter={56} decorative />
          <h1 className={s.h1}>
            {/* «Новий рік 2027 у Японії», коли є форма «у країні» (`names/<мова>.json` → `countriesIn`); інакше «Японія: Новий рік 2027». */}
            {site.inCountry(iso)
              ? t('titleIn', { ...SEASON_VALUES, inCountry: site.inCountry(iso) ?? '' })
              : t('title', { ...SEASON_VALUES, country: country.name })}
          </h1>
        </div>
        <p className={s.lead}>{country.described ? t('leadStory') : t('lead')}</p>
      </div>

      <section className={p.wrap} aria-label={t('midnightTitle')}>
        <div className={s.tiles}>
          <div className={s.tile}>
            <h2 className={s.kicker}>{t('midnightTitle')}</h2>
            {ready ? (
              <span className={s.big}>{clock(ms)}</span>
            ) : (
              <span className={s.big}>
                <Bar w={120} h={42} />
              </span>
            )}
            <span className={s.sub}>
              {ready
                ? t('midnightValue', { date: dayMonth(ms), time: clock(ms) })
                : t('midnightUtc', { date: dayMonth(ms, 'UTC'), time: clock(ms, 'UTC') })}
            </span>
            {ready ? (
              <span className={s.sub}>
                {t('midnightUtc', { date: dayMonth(ms, 'UTC'), time: clock(ms, 'UTC') })}
              </span>
            ) : null}
            <span className={s.sub}>
              {main?.city
                ? t('midnightCity', { city: main.city, utc: utcLabel(zone.offsetMinutes) })
                : utcLabel(zone.offsetMinutes)}
            </span>
          </div>
          <div className={s.tile}>
            <h2 className={s.kicker}>{t('countdownTitle')}</h2>
            {passed ? (
              <span className={s.tileTitle} role="timer" aria-live="off">
                {t('countdownPassed')}
              </span>
            ) : (
              <div className={s.cd} role="timer" aria-live="off">
                {units.map((u) => (
                  <div key={u.key}>
                    <b>{known ? u.text : <Bar w={44} h={34} />}</b>
                    <span>{t(u.key, { count: known ? u.n : 5 })}</span>
                  </div>
                ))}
              </div>
            )}
            <span className={s.sub}>{t('midnightLocal', SEASON_VALUES)}</span>
          </div>
          <div className={s.tile}>
            <h2 className={s.kicker}>{t('orderTitle')}</h2>
            <span className={s.big}>{t('orderValue', { n: zone.index + 1 })}</span>
            <span className={s.sub}>
              {zone.index === 0
                ? t('orderFirst')
                : zone.index === total - 1
                  ? t('orderLast')
                  : t('orderBefore', { count: zone.index })}
            </span>
          </div>
        </div>
        <div className={cn(p.cta, s.stay)}>
          <button
            type="button"
            className={cn(p.btn, p.btnCoral)}
            onClick={() =>
              downloadIcs(
                {
                  uid: `time2fest-${zone.id}-${iso.toLowerCase()}`,
                  title: t('calendarTitle', { country: country.name }),
                  description: t('calendarText', { country: country.name }),
                  startMs: ms,
                },
                `time2fest-${slug}.ics`,
              )
            }
          >
            <Icon name="calendar-add" size={20} />
            {t('addCalendar')}
          </button>
          <NextLink className={cn(p.btn, p.btnGhost)} href={site.href(PAGES.countries)}>
            {t('allCountries')}
          </NextLink>
        </div>
      </section>

      {country.described ? (
        <section className={cn(p.wrap, s.sec)} aria-labelledby="story-h">
          <h2 className={p.h2} id="story-h">
            {t('storyTitle', { country: country.name })}
          </h2>
          <div className={s.story}>
            <p className={s.storyText}>{country.text}</p>
            <div className={s.photo}>
              <MediaSlot
                slot={`country:${iso}`}
                item={site.media[`country:${iso}`]}
                mark
                alt={t('photoAlt', { country: country.name })}
                seed={20 + zone.index}
                bursts={4}
              />
            </div>
          </div>
          <h3 className={cn(p.h2, s.sec)} id="trad-h">
            {t('traditionsTitle')}
          </h3>
          <div className={s.tiles}>
            {country.traditions.map((x) => (
              <div className={s.tile} key={x.id}>
                <span className={s.ic}>
                  <Icon name={TRADITION_ICON[x.iconId] ?? 'star'} size={20} />
                </span>
                <h4 className={s.tileTitle}>{x.title}</h4>
                <p>{x.text}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={cn(p.wrap, s.sec)} aria-labelledby="zones-h">
        <h2 className={p.h2} id="zones-h">
          {t('zonesTitle')}
        </h2>
        <p className={s.note}>
          {country.zones.length > 1
            ? t('zonesMany', { count: country.zones.length })
            : t('zonesOne')}
        </p>
        <ul className={s.zones}>
          {country.zones.map((z) => {
            const zz = model.zonesById.get(z.zoneId);
            if (!zz) return null;
            const tz = ready ? undefined : 'UTC';
            return (
              <li key={z.zoneId}>
                <span>
                  <b>{z.city ?? utcLabel(zz.offsetMinutes)}</b>
                  {country.zones.length > 1 && z.zoneId === main?.zoneId ? (
                    <span className={s.zoneMain}>{t('zoneMain')}</span>
                  ) : null}
                </span>
                <span className={s.zoneUtc}>{utcLabel(zz.offsetMinutes)}</span>
                <span className={s.zoneTime}>
                  {dayMonth(zz.midnightMs, tz)}, <b>{clock(zz.midnightMs, tz)}</b>
                  {ready ? '' : ' UTC'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="live-h">
        <div className={s.panel}>
          <div>
            <h2 id="live-h">{t('liveTitle')}</h2>
            <p>{t('liveText')}</p>
          </div>
          <NextLink className={cn(p.btn, p.btnGhost)} href={site.href('/#schedule')}>
            {t('liveLink')}
          </NextLink>
        </div>
      </section>

      {neighbors.length ? (
        <section className={cn(p.wrap, s.sec)} aria-labelledby="near-h">
          <h2 className={p.h2} id="near-h">
            {t('neighborsTitle')}
          </h2>
          <ul className={s.chips}>
            {neighbors.map((c) => (
              <li key={c.iso}>
                <NextLink className={s.chipLink} href={c.href}>
                  <Flag code={c.flagCode} diameter={24} decorative />
                  {c.name}
                </NextLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

export function CountryPage({ site, iso }: { site: SiteData; iso: string }) {
  return (
    <SiteShell site={site} current="countries" page="S-PL-COUNTRY">
      <Body iso={iso} />
    </SiteShell>
  );
}
