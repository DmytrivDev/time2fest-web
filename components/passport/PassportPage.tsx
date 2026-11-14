'use client';

/**
 * S-PROFILE «Мій паспорт Нових років» (`/passport/`) за дошками `Desk-Passport-New` / `Phone-Passport-New` v1 (рішення
 * власника 2026-11-07, концепція `passport-concept-2026-11-07.md`), стан «під час свята». Сторінка в макеті з чатом
 * праворуч, як «Мій графік»:
 * - профіль і інфографіка: штампи, країни, континенти з 6, пояси з 38;
 * - «Твій шлях за свято»: мапа в рамці — пояси за станом, відвідані країни золотом, шлях через вузли поясів; легенда під
 *   рискою; «Поділитися шляхом / паспортом». Без пасу мапа затемнена з карткою пасу (мапа шляху — у пасі);
 * - штампи — листівки зі смужкою прапора, «Поділитися» в куті, оцінка лише під головними святкуваннями з трансляцією;
 *   «Хронологія · За континентами»; натиск — велика листівка на місці чату;
 * - «Наступний штамп»: країна з графіка або країни наступної півночі;
 * - серії: «Усі континенти», «5 поясів», «10 країн», «Усі пояси за свято».
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useHeaderUser } from '@/components/auth/session';
import { PageChat } from '@/components/chat/PageChat';
import { PathMap } from '@/components/live/PathMap';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useOverlay } from '@/components/shell/OverlayManager';
import { shareWindowSpec } from '@/components/windows/Share';
import { StampArt } from '@/components/windows/StampArt';
import { StampRate } from '@/components/windows/StampRate';
import { stampEntry } from '@/components/live/StampBlock';
import { useStamps } from '@/lib/api/hooks/passport';
import { routeCities } from '@/lib/chat/authorPath';
import { getData } from '@/lib/data/load';
import { zoneState } from '@/lib/engine/zoneState';
import { formatClock, formatDurationShort, utcLabel, viewerZoneLabel } from '@/lib/i18n/time';
import {
  CONTINENTS,
  nextMidnightOfContinent,
  nextStamp,
  passportStamps,
  passportStats,
  type Continent,
  type PassportStamp,
} from '@/lib/passport/passport';
import { buildSchedulePath } from '@/lib/schedule/schedulePath';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { ratingActions, useMyVotes } from '@/lib/api/hooks/rating';
import { BIG_POSTCARD_ID, BigPostcard } from './BigPostcard';
import { FlagStrip } from './FlagStrip';
import { PassportHowTo } from './PassportHowTo';
import { PathLock } from './PathLock';
import { usePassportShare } from './PassportShare';
import s from './passport.module.css';
import { useHasPass, useProfile, useSchedule } from '@/lib/api/hooks/auth';


export function PassportPage() {
  const t = useTranslations('passport');
  const tMap = useTranslations('passport.map');
  const tStamp = useTranslations('windows.achievement');
  const tShare = useTranslations('share');
  const locale = useLocale();
  const timeReady = useTimeReady();
  const now = useNow({ granularity: 'minute' });
  const user = useHeaderUser();
  const hasPass = useHasPass();
  const stamps = useStamps();
  const scheduleRaw = useSchedule();
  const profile = useProfile();
  const nick = profile?.nick ?? undefined;
  const flagCode = profile?.flagCode ?? undefined;
  const myVotes = useMyVotes();
  const overlay = useOverlay();
  const share = usePassportShare();
  const [view, setView] = useState<'chrono' | 'continents'>('chrono');
  // Дані гостя — з localStorage: до гідрації не малюємо список, щоб не мигтіло «0 штампів».
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- позначка «клієнт змонтовано»
  useEffect(() => setReady(true), []);

  const data = getData();
  const schedule = useMemo(() => (hasPass ? scheduleRaw : []), [hasPass, scheduleRaw]);
  const rows = useMemo(() => (ready ? passportStamps(stamps, data) : []), [ready, stamps, data]);
  const stats = passportStats(rows, data);
  const zoneStates = useMemo(
    () => Object.fromEntries(data.zones.map((z) => [z.id, now > 0 ? zoneState(now, z, data.zones) : 'future'])),
    [data, now],
  );
  // Шлях: зустрінуті й лише наступний вузол з графіка («Далі за графіком»).
  const fullPath = useMemo(() => (ready ? buildSchedulePath(stamps, schedule, data, now) : []), [ready, stamps, schedule, data, now]);
  const met = fullPath.filter((p) => !p.planned);
  const nextHub = fullPath.find((p) => p.planned && !p.hubOf && p.midnightMs >= now);
  const points = nextHub ? [...met, { ...nextHub, current: false }] : met;
  const visited = rows.map((r) => ({ zoneId: r.zoneId, iso: r.countryIso }));
  const route = routeCities(met.filter((p) => !p.hubOf), 3).met.join(' → ');
  const next = ready ? nextStamp(data, schedule, now) : null;
  const name = nick || t('guestName');

  const tilesStats = [
    { value: String(stats.stamps), label: t('tiles.stamps', { count: stats.stamps }) },
    { value: String(stats.countries), label: t('tiles.countries', { count: stats.countries }) },
    { value: String(stats.continents.size), label: t('tiles.continents', { count: stats.continents.size }) },
    { value: String(stats.zones), label: t('tiles.zones', { count: stats.zones }) },
  ];
  const shareData = { name, stats: tilesStats, route: route || t('map.empty'), rows, points: met, zoneStates };

  const openBig = useCallback(
    (index: number) =>
      overlay.open({
        id: BIG_POSTCARD_ID,
        kind: 'accent',
        chrome: 'board',
        title: t('big.title'),
        content: <BigPostcard rows={rows} start={index} />,
      }),
    [overlay, rows, t],
  );

  const card = (r: PassportStamp, index: number) => {
    const entry = stampEntry(r.eventId);
    const stars = myVotes[r.eventId];
    return (
      <li key={r.eventId} className={s.card} data-stamp-card={r.eventId} data-rateable={r.rateable || undefined}>
        <FlagStrip code={r.flagCode} />
        <div className={s.cardArt}>
          <button type="button" aria-label={t('open', { city: r.city })} onClick={() => openBig(index)} className={cn('t2f-focus', s.cardOpen)}>
            <StampArt illustrationId={r.illustrationId} stampText={tStamp('stamped', { city: r.city.toLocaleUpperCase('uk') })} />
          </button>
          {entry ? (
            <button
              type="button"
              aria-label={t('share', { city: r.city })}
              onClick={() => overlay.open(shareWindowSpec([entry], tShare('title')))}
              className={cn('t2f-focus t2f-press', s.cardShare)}
            >
              <Icon name="share" size={16} />
            </button>
          ) : null}
        </div>
        <div className={s.cardBody}>
          <p className={s.cardCity}>
            <Flag code={r.flagCode} diameter={20} decorative />
            {r.city}
          </p>
          <p className={s.cardMeta}>
            {`${r.country} · ${formatClock(r.midnightMs, { locale })}`}
          </p>
          {/* Оцінка — лише головні святкування з трансляцією (рішення власника 2026-11-07); оцінити можна будь-коли. */}
          {r.rateable ? (
            <StampRate
              layout="compact"
              rows={[{ eventId: r.eventId, city: r.city }]}
              values={stars !== undefined ? { [r.eventId]: stars } : {}}
              onRate={(id, v) => void ratingActions.vote(id, v)}
              className={s.cardRate}
            />
          ) : (
            <p className={s.cardNoRate}>{t('noRate')}</p>
          )}
        </div>
      </li>
    );
  };

  // «Наступний штамп» (дошка `Desk-Passport-Next`, власник 2026-11-07): плитка такого самого розміру, як листівки, у ряду
  // штампів — завжди; без пасу ще й невеликий блок після штампів (країни поясу, «Усі країни поясу», «Мій графік»).
  const nextChip = next ? `${formatClock(next.midnightMs, { locale })} · ${t('nextIn', { time: formatDurationShort(next.midnightMs - now) })}` : '';
  const nextCell = (() => {
    if (!next) return null;
    const sched = next.kind === 'schedule';
    const flags = sched ? [next.country] : next.countries.slice(0, 3);
    return (
      <li className={cn(s.card, s.next)} data-next={next.kind}>
        <span aria-hidden="true" className={s.nextStrip} />
        <div className={s.nextArt}>
          {next.kind === 'schedule' ? (
            <StampArt illustrationId={data.countriesByIso.get(next.country.iso)?.illustrationId ?? 'generic'} stampText={tStamp('stamped', { city: next.country.place.split(' · ')[0]!.toLocaleUpperCase('uk') })} />
          ) : (
            <span aria-hidden="true" className={s.nextBlank}>
              <span className={s.nextBlankIn}>
                <span className={s.nextRing} />
              </span>
            </span>
          )}
          <span className={s.nextChip}>
            <Icon name="clock" size={16} />
            {nextChip}
          </span>
        </div>
        <div className={s.cardBody}>
          <p className={s.nextKicker}>{t('next.tileKicker')}</p>
          <p className={s.cardCity}>
            {flags.map((c) => (
              <Flag key={c.iso} code={c.flagCode} diameter={20} decorative />
            ))}
            {sched ? next.country.place.split(' · ')[0] : t('next.tileZoneName', { utc: utcLabel(next.offsetMinutes) })}
          </p>
          <div className={s.nextSlot}>
            <span>{sched ? t('next.tileSchedule', { country: next.country.name }) : t('next.tileZone', { count: next.total })}</span>
            <NextLink
              href={sched ? next.country.href : `/countries/?zone=${encodeURIComponent(next.zoneId)}`}
              className={cn('t2f-focus', s.nextLink)}
            >
              {sched ? t('next.countryPage') : t('next.allCountries')}
              <Icon name="chevron-right" size={14} />
            </NextLink>
          </div>
        </div>
      </li>
    );
  })();
  const nextBlock =
    next && next.kind === 'zone' && !hasPass ? (
      <div className={s.nextBlock} data-next-block="">
        <div className={s.nextBlockHead}>
          <span aria-hidden="true" className={s.nextBlockIcon}>
            <Icon name="clock" size={18} />
          </span>
          <div className={s.nextBlockText}>
            <p className={s.nextBlockTitle}>
              {t('next.blockTitle', { in: t('nextIn', { time: formatDurationShort(next.midnightMs - now) }), time: formatClock(next.midnightMs, { locale }) })}
            </p>
            <p className={s.nextBlockSub}>{t('next.blockSub', { count: next.total, utc: utcLabel(next.offsetMinutes) })}</p>
          </div>
          <div className={s.nextBtns}>
            <NextLink href={`/countries/?zone=${encodeURIComponent(next.zoneId)}`} className={cn('t2f-focus t2f-press', s.smallBtn)}>
              {t('next.allCountries')}
            </NextLink>
            <NextLink href="/schedule/" className={cn('t2f-focus t2f-press', s.smallBtn)}>
              <Icon name="calendar" size={14} />
              {t('next.toSchedule')}
              <span className={s.passTag}>{t('next.passTag')}</span>
            </NextLink>
          </div>
        </div>
        <ul className={s.nextChips}>
          {next.countries.slice(0, 5).map((c) => (
            <li key={c.iso}>
              <NextLink href={c.href} className={cn('t2f-focus', s.nextChipLink)}>
                <Flag code={c.flagCode} diameter={16} decorative />
                {c.name}
              </NextLink>
            </li>
          ))}
          {next.total > 5 ? <li className={s.nextMore}>{t('next.more', { count: next.total - 5 })}</li> : null}
        </ul>
      </div>
    ) : null;

  const nextPair = rows.length === 0 && !!nextCell && !!nextBlock;

  const contName = (c: Continent) => t(`continent.${c}`);
  const missing = CONTINENTS.filter((c) => !stats.continents.has(c));

  return (
    <div id="content" tabIndex={-1} className={cn(s.pageWrap, 'focus:outline-none')} data-page="S-PROFILE">
      <header className={s.head}>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.sub}>{t('subtitle', { zone: timeReady ? viewerZoneLabel() : '' })}</p>
      </header>

      <section className={s.box} aria-label={t('profileLabel')} data-passport-profile="">
        <div className={s.who}>
          <span aria-hidden="true" className={s.avatar}>
            {name.slice(0, 1).toLocaleUpperCase('uk')}
          </span>
          <div className={s.whoText}>
            <p className={s.name}>
              {name}
              {hasPass ? (
                <span className={s.passBadge}>
                  {t('passBadge')}
                  <Icon name="check" size={12} strokeWidth={2.6} />
                </span>
              ) : null}
            </p>
            <p className={s.from}>
              {flagCode ? <Flag code={flagCode} diameter={16} decorative /> : null}
              {flagCode ? t('seasonLine', { country: data.countriesByIso.get(flagCode)?.name.uk ?? flagCode }) : t('seasonLineNoFlag')}
            </p>
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
        </div>
        <dl className={s.tiles}>
          {[
            { v: stats.stamps, l: t('tiles.stamps', { count: stats.stamps }) },
            { v: stats.countries, l: t('tiles.countries', { count: stats.countries }) },
            { v: stats.continents.size, l: t('tiles.continents', { count: stats.continents.size }), of: CONTINENTS.length },
            { v: stats.zones, l: t('tiles.zones', { count: stats.zones }), of: stats.zonesTotal },
          ].map((x) => (
            <div key={x.l} className={s.tile} data-tile="">
              <dd className={s.tileNum}>
                {x.v}
                {x.of ? <span className={s.tileOf}>{t('tiles.of', { total: x.of })}</span> : null}
              </dd>
              <dt className={s.tileLabel}>{x.l}</dt>
              {x.of ? (
                <span aria-hidden="true" className={s.tileBar}>
                  <span style={{ width: `${Math.round((x.v / x.of) * 100)}%` }} />
                </span>
              ) : null}
            </div>
          ))}
        </dl>
      </section>

      <section className={s.box} aria-labelledby="passport-map-title" data-passport-map={hasPass ? 'pass' : 'locked'}>
        <div className={s.mapHead}>
          <h2 id="passport-map-title" className={s.h2}>
            {tMap('title')}
          </h2>
          <span className={s.mapCounts}>
            {hasPass ? tMap('counts', { countries: stats.countries, continents: stats.continents.size, zones: stats.zones }) : tMap('locked')}
          </span>
        </div>
        <div className={s.mapFrame}>
          <div className={s.mapWrap}>
            <PathMap
              points={points}
              authorName=""
              summary={route || tMap('empty')}
              zoneStates={zoneStates}
              visited={visited}
              locked={!hasPass}
              className={s.map}
            />
            {!hasPass ? <PathLock /> : null}
          </div>
          {hasPass ? (
            <div className={s.mapFoot}>
              <ul className={s.legend} aria-hidden="true">
                <li>
                  <span className={s.legDot} />
                  {tMap('legendMet')}
                </li>
                <li>
                  <span className={s.legRing} />
                  {tMap('legendNext')}
                </li>
              </ul>
              <ul className={s.legend} aria-hidden="true">
                <li>
                  <span className={s.sw} data-sw="visited" />
                  {tMap('legendVisited')}
                </li>
                <li>
                  <span className={s.sw} data-sw="past" />
                  {tMap('legendPast')}
                </li>
                <li>
                  <span className={s.sw} data-sw="live" />
                  {tMap('legendNow')}
                </li>
                <li>
                  <span className={s.sw} data-sw="future" />
                  {tMap('legendAhead')}
                </li>
              </ul>
            </div>
          ) : null}
        </div>
        {hasPass ? (
          <>
            {route || nextHub ? (
              <p className={s.route}>
                {route ? <b>{route}</b> : null}
                {nextHub ? <span>{tMap('next', { city: nextHub.city, time: formatClock(nextHub.midnightMs, { locale }) })}</span> : null}
              </p>
            ) : null}
            <div className={s.shareRow}>
              <button type="button" disabled={!rows.length} onClick={() => share('route', shareData)} className={cn('t2f-focus t2f-press', s.btnCoral)} data-action="share-route">
                <Icon name="share" size={18} />
                {tMap('shareRoute')}
              </button>
              <button type="button" disabled={!rows.length} onClick={() => share('passport', shareData)} className={cn('t2f-focus t2f-press', s.btnSecondary)} data-action="share-passport">
                <Icon name="passport" size={18} />
                {tMap('sharePassport')}
              </button>
            </div>
          </>
        ) : null}
      </section>

      <section aria-labelledby="passport-stamps" className={s.stamps}>
        <div className={s.stampsHead}>
          <h2 id="passport-stamps" className={s.h2}>
            {t('stampsTitle')}
          </h2>
          <span className={s.count}>{rows.length}</span>
          <span className={s.headSpacer} />
          <div role="group" aria-label={t('viewLabel')} className={s.seg}>
            <button type="button" aria-pressed={view === 'chrono'} onClick={() => setView('chrono')} className={cn('t2f-focus', s.segBtn)}>
              {t('viewChrono')}
            </button>
            <button type="button" aria-pressed={view === 'continents'} onClick={() => setView('continents')} className={cn('t2f-focus', s.segBtn)}>
              {t('viewContinents')}
            </button>
          </div>
        </div>
        {ready && rows.length === 0 ? <p className={s.empty}>{t('empty')}</p> : null}
        {view === 'chrono' && nextPair ? (
          // Ще без штампів: плитка наступного штампа й «що робити» — парою (на планшеті поруч, 1/3 і 2/3; дошки
          // `Tab-P-New` / `Tab-L-New`, 2026-11-10); на телефоні й десктопі обгортка не впливає на розкладку.
          <div className={s.nextPair}>
            <ul className={s.grid}>{nextCell}</ul>
            {nextBlock}
          </div>
        ) : view === 'chrono' ? (
          <ul className={s.grid}>
            {rows.map((r, i) => card(r, i))}
            {nextCell}
          </ul>
        ) : (
          <>
            {CONTINENTS.filter((c) => stats.continents.has(c)).map((c) => (
              <section key={c} aria-label={contName(c)} className={s.contGroup}>
                <h3 className={s.contTitle}>
                  {contName(c)} · {rows.filter((r) => r.continent === c).length}
                </h3>
                <ul className={s.grid}>{rows.map((r, i) => (r.continent === c ? card(r, i) : null))}</ul>
              </section>
            ))}
            {missing.length ? (
              <ul className={s.missing}>
                {missing.map((c) => {
                  const at = nextMidnightOfContinent(data, c, now);
                  return (
                    <li key={c} className={s.missingItem}>
                      <b>{contName(c)}</b>
                      {at ? t('continentMissing', { time: formatClock(at, { locale }) }) : t('continentMissingNone')}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        )}
        {nextPair && view === 'chrono' ? null : nextBlock}
      </section>

      <section className={s.box} aria-labelledby="passport-series" data-passport-series="">
        <div className={s.mapHead}>
          <h2 id="passport-series" className={s.h2}>
            {t('series.title')}
          </h2>
          <span className={s.mapCounts}>{t('series.sub')}</span>
        </div>
        <div className={s.seriesRow}>
          <div className={s.seriesHead}>
            <b>{t('series.continents')}</b>
            <span className={s.seriesProgress}>{t('series.progress', { done: stats.continents.size, total: CONTINENTS.length })}</span>
          </div>
          <ul className={s.seals}>
            {CONTINENTS.map((c) => (
              <li key={c} className={cn(s.seal, stats.continents.has(c) && s.sealDone)}>
                {contName(c)}
              </li>
            ))}
          </ul>
        </div>
        {[
          { key: 'fiveZones', done: Math.min(stats.zones, 5), total: 5 },
          { key: 'tenCountries', done: Math.min(stats.countries, 10), total: 10 },
          { key: 'allZones', done: stats.zones, total: stats.zonesTotal },
        ].map((x) => (
          <div key={x.key} className={s.seriesLine}>
            <div className={s.seriesMain}>
              <b>{t(`series.${x.key}` as 'series.fiveZones')}</b>
              <span aria-hidden="true" className={cn(s.tileBar, x.done >= x.total && s.tileBarDone)}>
                <span style={{ width: `${Math.round((x.done / x.total) * 100)}%` }} />
              </span>
            </div>
            {x.done >= x.total ? (
              <span className={cn(s.seal, s.sealDone, s.sealSmall)}>{t(`series.${x.key}` as 'series.fiveZones')}</span>
            ) : (
              <span className={s.seriesProgress}>{t('series.progress', { done: x.done, total: x.total })}</span>
            )}
          </div>
        ))}
      </section>
      <PassportHowTo signedIn={!!user} />
      <PageChat />
    </div>
  );
}

