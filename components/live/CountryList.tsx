'use client';

/**
 * C19. «Країни й міста» (S-COUNTRIES / S-LIST) — довідник країн за поясами (рішення власника 2026-11-04, дошка
 * `Desk-Countries-Next`, вайрфрейм v2). Що зараз і що далі дивитися — на головній; тут — знайти країну, побачити, коли там
 * північ і чи є трансляція, і перейти на її сторінку.
 *
 * Зверху вниз: `h1` і підзаголовок з датою й часом гостя · пошук, фільтр «Усі · З трансляціями · Мій графік» (як у «Зараз і
 * далі»), «Мапа | Список» · список: рядки поясів — ті самі, що у «Списку» на головній (п’ять прапорців і «ще N»), усі 38 по
 * черзі, «Вже зустріли» — згорнуто внизу; на старті всі згорнуті. Розгорнутий пояс — один рядок про пояс і повний список
 * країн за регіонами великими картками зі статусом; клік по картці — сторінка країни. Пошук і фільтри звужують рядки й
 * картки: лишаються пояси зі збігами, розгорнуті. «Мапа» — компонент головної. Колонка чату — як на головній.
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useLiveChat } from '@/components/chat/useLiveChat';
import { Faq, type FaqItem } from '@/components/live/Faq';
import { buildMapModel, type MapCountry, type MapZone, type ZoneMapGeometry } from '@/lib/map/model';
import { ZoneMap } from '@/components/map/ZoneMap';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useChatRooms } from '@/lib/api/hooks/chat';
import { getData } from '@/lib/data/load';
import type { Dataset, Ms } from '@/lib/data/types';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { zoneState, type ZoneState } from '@/lib/engine/zoneState';
import { formatClock, formatCountdown, formatDurationShort, formatTimeForViewer, viewerZoneLabel } from '@/lib/i18n/time';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { fold, getSearchIndex, matchesCityName, matchesCountryName, type SearchIndex } from '@/lib/search/countrySearch';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { EventFilter } from './EventFilter';
import { SubtitleSkeleton, ZoneRowsSkeleton } from './CountriesSkeleton';
import { useMidnightPhrase } from '@/components/map/ZoneMapCards';
import { MapScheduleContext, PlayMark, ScheduleButton } from '@/components/map/MapStreamCard';
import { StateBadge } from '@/components/map/ZonePanel';
import { ZoneListView } from '@/components/map/ZoneListView';
import { usePhone } from '@/lib/hooks/useMedia';
import { REGION_ORDER, regionOf, type RegionKey } from '@/lib/geo/regions';
import nn from './nowNext.module.css';
import styles from './countryList.module.css';
import { useHasPass, useSchedule } from '@/lib/api/hooks/auth';

type Filter = 'all' | 'live' | 'mine';
const NOT_FIRST = new Set(['RU', 'BY']);

export interface CountryListProps {
  /** Геометрія мапи (`data/zonemap.json`); без неї підвантажується окремим шматком. */
  geometry?: ZoneMapGeometry;
  /** Набір даних (за замовчуванням — `getData()`); для історій і тестів. */
  data?: Dataset;
  className?: string;
}

// Пошук усіма мовами сайту (uk/en/es/fr), без регістру, діакритики, дефісів і апострофів — `lib/search/countrySearch.ts`
// (рішення власника 2026-11-09): «nepal», «India», «new york», «Kyiv», «Britain», «sao paulo» знаходять потрібне.

interface Hit {
  /** Місто, через яке знайшлася країна (назва країни не збіглася). */
  city?: string;
}

/** Країна підходить під пошук: за назвою (будь-якою мовою сайту), головним містом чи містом трансляції. */
export function matchCountry(c: MapCountry, q: string, index: SearchIndex): Hit | null {
  if (!q) return {};
  if (matchesCountryName(c.iso, c.name, q)) return {};
  const cities = [c.city, ...(c.streams ?? []).map((s) => s.city)].filter((x): x is string => !!x);
  const city = cities.find((x) => matchesCityName(index, x, q));
  return city ? { city } : null;
}

// ── Картка країни ──────────────────────────────────────────────────────────

/**
 * Картка країни в розгорнутому поясі: прапор, назва, місто, статус — «▶ Трансляція» (йде; біла залита кнопка, як у «Країнах
 * поясу» на головній), «▶ трансляція о 02:00» з календариком (ще буде), «▶ повтор» (минула), «лише відлік». Клік — сторінка
 * країни. Календарик — поза посиланням (кнопка в посиланні неприпустима), у правому нижньому куті.
 */
function CountryCard({ c, state, zone, hit }: { c: MapCountry; state: ZoneState; zone: MapZone; hit: Hit }) {
  const t = useTranslations('countries.card');
  const tp = useTranslations('liveMap.panel');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });
  const stream = c.streams?.[0];
  const after = state === 'past' || now >= zone.midnightMs + HANDOVER_AFTER;
  const kind = !stream ? 'none' : state === 'live' && !after ? 'live' : after ? 'replay' : 'soon';
  // Подія країни в цьому поясі (головна — та, що з трансляцією; інакше перша — лише відлік).
  const eventId = stream?.eventId ?? c.eventIds?.[0];
  const upcoming = !after && now < zone.midnightMs;
  return (
    <li className={styles.card} data-country-card={c.iso} data-status={kind}>
      <NextLink href={c.href} className={cn('t2f-focus', styles.cardLink)}>
        <Flag code={c.flagCode} diameter={36} decorative />
        <span className={styles.cardName}>{c.name}</span>
        {c.city ? <span className={styles.cardCity}>{c.city}</span> : null}
        {hit.city && hit.city !== c.city ? <span className={styles.hit}>{t('cityHit', { city: hit.city })}</span> : null}
        <span className={styles.cardFoot}>
          {kind === 'live' ? (
            <span className={styles.liveBtn}>
              <PlayMark tone="live" size={14} />
              {tp('streamLiveBtn')}
            </span>
          ) : kind === 'soon' ? (
            <span className={styles.soon}>
              <PlayMark tone="upcoming" size={12} />
              {/* Телефон: коротко «▶ о 05:00» — в один рядок. */}
              <span className={styles.long}>{t('streamAt', { time: formatClock(zone.midnightMs, { locale }) })}</span>
              <span className={styles.short}>
                {t('streamAtShort', { time: formatClock(zone.midnightMs, { locale }) })}
              </span>
            </span>
          ) : kind === 'replay' ? (
            <span className={styles.replay}>
              <PlayMark tone="replay" size={12} />
              {t('replay')}
            </span>
          ) : (
            <span className={styles.none}>{tp('streamNo')}</span>
          )}
        </span>
      </NextLink>
      {upcoming && eventId ? (
        <span className={styles.cal}>
          <ScheduleButton eventId={eventId} city={stream?.city ?? c.name} />
        </span>
      ) : null}
    </li>
  );
}

// ── Розгорнутий пояс ───────────────────────────────────────────────────────

/** Один рядок про пояс: стан, відлік (чи скільки тому), о котрій за вашим часом, скільки країн і трансляцій. */
function ZoneSummary({ zone, state, total }: { zone: MapZone; state: ZoneState; total: MapZone }) {
  const t = useTranslations('countries.zone');
  const tp = useTranslations('liveMap.panel');
  const locale = useLocale();
  const now = useNow();
  const when = useMidnightPhrase(zone.midnightMs);
  const after = state === 'past' || now >= zone.midnightMs + HANDOVER_AFTER;
  const streams = total.countries.filter((c) => (c.streams?.length ?? 0) > 0).length;
  return (
    <p className={styles.summary} data-zone-summary="">
      <StateBadge state={state} />
      {after ? (
        <span>{t('ago', { dur: formatDurationShort(Math.max(0, now - zone.midnightMs), locale) })}</span>
      ) : now < zone.midnightMs ? (
        <span>
          {t('until')} <b className={styles.timer}>{formatCountdown(zone.midnightMs - now)}</b>
        </span>
      ) : null}
      <span className={styles.muted}>{when}</span>
      <span className={styles.muted}>
        {total.countries.length} {tp('countriesWord', { count: total.countries.length })} · {streams}{' '}
        {tp('streamsWord', { count: streams })}
      </span>
    </p>
  );
}

/** Повний список країн поясу за регіонами (картки); у пошуку — лише збіги, без заголовків регіонів, якщо їх мало. */
function ZoneDirectory({
  zone,
  state,
  total,
  hits,
  searching,
}: {
  zone: MapZone;
  state: ZoneState;
  total: MapZone;
  hits: ReadonlyMap<string, Hit>;
  searching: boolean;
}) {
  const tR = useTranslations('liveMap.regions');
  const groups = new Map<RegionKey | 'other', MapCountry[]>();
  // Росія й Білорусь — не серед перших (рішення власника 2026-11-03): у кінці свого регіону.
  const list = [...zone.countries.filter((c) => !NOT_FIRST.has(c.iso)), ...zone.countries.filter((c) => NOT_FIRST.has(c.iso))];
  for (const c of list) {
    const r = regionOf(c.iso, zone.offsetMinutes) ?? 'other';
    groups.set(r, [...(groups.get(r) ?? []), c]);
  }
  const ordered = [...REGION_ORDER, 'other' as const].filter((r) => groups.has(r));
  const card = (c: MapCountry) => <CountryCard key={c.iso} c={c} state={state} zone={zone} hit={hits.get(`${zone.id}:${c.iso}`) ?? {}} />;
  return (
    <div className={styles.dir} data-zone-directory={zone.id}>
      <ZoneSummary zone={zone} state={state} total={total} />
      {searching && zone.countries.length <= 4 ? (
        <ul className={styles.grid}>{list.map(card)}</ul>
      ) : (
        ordered.map((r) => (
          <section key={r} className={styles.region} data-region={r}>
            <h4 className={styles.regionTitle}>
              {tR(r)} · {groups.get(r)!.length}
            </h4>
            <ul className={styles.grid}>{groups.get(r)!.map(card)}</ul>
          </section>
        ))
      )}
    </div>
  );
}

// ── Питання й відповіді ────────────────────────────────────────────────────

function useFaqItems(data: Dataset, now: Ms, ready: boolean): FaqItem[] {
  const t = useTranslations('countries.faq');
  const tNav = useTranslations('nav');
  return useMemo(() => {
    const zones = [...data.zones].sort((a, b) => a.midnightMs - b.midnightMs);
    const firstZone = zones[0];
    const lastZone = zones[zones.length - 1];
    const londonZone = data.zonesById.get(data.citiesById.get('london')?.zoneId ?? '') ?? zones.find((z) => z.offsetMinutes === 0);
    const at = (ms: Ms) => formatTimeForViewer(ms, { now }).text;
    const first =
      ready && firstZone && lastZone ? t('firstAnswerTimed', { first: at(firstZone.midnightMs), last: at(lastZone.midnightMs) }) : t('firstAnswer');
    const london = ready && londonZone ? t('londonAnswerTimed', { time: at(londonZone.midnightMs) }) : t('londonAnswer');
    return [
      { id: 'first-country', question: tNav('faqFirstCountry'), answer: first },
      { id: 'london-time', question: t('londonQuestion'), answer: london },
      { id: 'why-different', question: t('whyQuestion'), answer: t('whyAnswer') },
    ];
  }, [data, now, ready, t, tNav]);
}

// ── Сторінка ───────────────────────────────────────────────────────────────

export function CountryList({ geometry, data: dataProp, className }: CountryListProps) {
  const t = useTranslations('countries');
  const tNav = useTranslations('nav');
  const tNN = useTranslations('liveCards.nowNext');
  const tCommon = useTranslations('common');
  const tChat = useTranslations('chat');
  const locale = useLocale();
  // «Усі країни поясу ›» зі сторінки країни: `?zone=utc+0100` — пояс розгорнуто й прокручено до нього.
  const [focusZone, setFocusZone] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- адреса відома лише в браузері (статична сторінка)
    setFocusZone(new URLSearchParams(window.location.search).get('zone'));
  }, []);
  const ready = useTimeReady();
  const now = useNow({ granularity: 'minute' });
  const hasPass = useHasPass();
  const schedule = useSchedule();
  const data = dataProp ?? getData();
  const phone = usePhone();
  const chatColumn = useChatColumn();
  const chat = useLiveChat({ chatColumn, room: 'world', roomLabel: tChat('roomWorld'), panel: { startInWorld: true } });
  const passWindows = useOfferWindows();
  const getPass = useGetPass();
  useChatRooms(useMemo(() => ['world' as const], []));

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'list' | 'map'>('list');

  const mapModel = useMemo(() => buildMapModel(data), [data]);
  const byId = useMemo(() => new Map(mapModel.zones.map((z) => [z.id, z])), [mapModel]);
  const states = useMemo(() => {
    const m = new Map<string, ZoneState>();
    for (const z of mapModel.zones) m.set(z.id, now > 0 ? zoneState(now, z, mapModel.zones) : 'future');
    return m;
  }, [mapModel, now]);
  const stateOf = (id: string): ZoneState => states.get(id) ?? 'future';

  // Скільки країн у графіку (для лічильника біля «Мій графік», як у «Зараз і далі»).
  const scheduleCount = useMemo(
    () => mapModel.zones.reduce((n, z) => n + z.countries.filter((c) => (c.eventIds ?? []).some((id) => schedule.includes(id))).length, 0),
    [mapModel, schedule],
  );
  const q = fold(query);
  const searchIndex = useMemo(() => getSearchIndex(data), [data]);
  const searching = q !== '';
  const locked = filter === 'mine' && !hasPass;
  const narrowing = searching || filter !== 'all';
  // Пояси з картками, що лишаються після пошуку й фільтра; збіги за містом — для позначки на картці.
  const { zones, hits } = useMemo(() => {
    const hitMap = new Map<string, Hit>();
    const out: MapZone[] = [];
    for (const z of mapModel.zones) {
      const countries = z.countries.filter((c) => {
        if (filter === 'live' && !(c.streams?.length ?? 0)) return false;
        if (filter === 'mine' && hasPass && !(c.eventIds ?? []).some((id) => schedule.includes(id))) return false;
        const hit = matchCountry(c, q, searchIndex);
        if (!hit) return false;
        hitMap.set(`${z.id}:${c.iso}`, hit);
        return true;
      });
      if (countries.length || !narrowing) out.push({ ...z, countries });
    }
    return { zones: out, hits: hitMap };
  }, [mapModel, filter, hasPass, schedule, q, narrowing, searchIndex]);

  const subtitle = ready
    ? t('subtitle', {
        zone: viewerZoneLabel(),
        date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(now),
        time: formatClock(now, { locale }),
      })
    : t('subtitleStatic');
  const faqItems = useFaqItems(data, now, ready);
  const empty = ready && narrowing && !locked && zones.length === 0;


  // Той самий фільтр, що в «Зараз і далі» на головній (`EventFilter`, правка власника 2026-11-04).
  const filterControl = (
    <EventFilter
      value={filter}
      onValueChange={(v) => {
        setFilter(v);
        // Фільтр звужує список — з «Мапи» одразу на «Список», де видно результат.
        if (v !== 'all') setView('list');
      }}
      scheduleLocked={!hasPass}
      scheduleCount={scheduleCount}
      label={t('filterLabel')}
      className={cn(styles.filter, styles.filterResp)}
    />
  );

  // «Мапа | Список» — тим самим виглядом, що фільтр. Телефон: над пошуком на всю ширину (правка власника 2026-11-04);
  // місце й ширину задає CSS, а не скрипт, — вигляд правильний із першого кадру (правка 2026-11-05).
  const viewControl = (
    <div role="group" aria-label={t('viewLabel')} className={cn(nn.filter, styles.viewCtl)} data-row="view">
      {(['map', 'list'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          data-state={view === v ? 'on' : 'off'}
          className={cn('t2f-focus', nn.seg)}
          onClick={() => {
            setView(v);
            // На «Мапі» фільтр не діє — повертаємо «Усі» (правка власника 2026-11-04).
            if (v === 'map') setFilter('all');
          }}
        >
          {v === 'map' ? tNav('mapShort') : tNav('list')}
        </button>
      ))}
    </div>
  );

  return (
    <MapScheduleContext.Provider value={passWindows.requestSchedule}>
      <div data-countries-page="" className={cn(styles.page, className)}>
        <header className={styles.head}>
          <div className="min-w-0 flex-1">
            <h1 className="text-headline-md text-text">{t('title')}</h1>
            {ready ? (
              <p className={cn('m-0 text-body text-text-secondary', styles.subtitle)}>{subtitle}</p>
            ) : (
              <SubtitleSkeleton />
            )}
          </div>
          {chat.showButton}
        </header>

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Icon name="search" size={18} className={styles.searchIcon} />
            <input
              aria-label={t('searchLabel')}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // Пошук показує знайдене в списку: з «Мапи» — одразу на «Список» (правка власника 2026-11-04).
                if (e.target.value.trim()) setView('list');
              }}
              placeholder={t('searchLabel')}
              autoComplete="off"
              enterKeyHint="search"
              className={cn('t2f-focus', styles.searchInput)}
              data-countries-search=""
            />
            {query ? (
              <button type="button" className={cn('t2f-focus', styles.clear)} onClick={() => setQuery('')}>
                {t('clear')}
              </button>
            ) : null}
          </div>
          <div className={styles.controls}>
            {filterControl}
            {viewControl}
          </div>
        </div>

        {locked ? (
          <div role="status" data-row="mine-locked" className={cn(nn.lockedBar, phone && nn.lockedBarStack)}>
            <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-highlight" />
            <p className={nn.lockedText}>{tNN.rich('mineLockedText', { b: (c) => <b className="font-bold">{c}</b> })}</p>
            <span className={nn.lockedActions}>
              <Button variant="coral" compact iconLeft="ticket" data-action="get-pass" onClick={() => getPass()}>
                {tNN('mineLockedGet', { price: formatUsd(PASS_PRICE) })}
              </Button>
              <Button variant="tonal" compact data-action="pass-info" onClick={passWindows.openPassInfoBoard}>
                {tNN('mineLockedButton')}
              </Button>
            </span>
          </div>
        ) : null}

        {view === 'map' ? (
          <ZoneMap {...mapModel} {...(geometry ? { geometry } : {})} headless onToggleSchedule={passWindows.requestSchedule} />
        ) : (
          <div role="region" aria-label={t('listLabel')} aria-busy={!ready || undefined} className={styles.list}>
            {!ready ? (
              <>
                <span className="sr-only">{tCommon('loading')}</span>
                <ZoneRowsSkeleton />
              </>
            ) : empty ? (
              <p role="status" className="m-0 rounded-md bg-surface p-4 text-body text-text-secondary">
                {searching ? t('empty') : t('emptyFilters')}
              </p>
            ) : locked ? null : (
              <ZoneListView
                // Новий пошук чи фільтр — свіжий список (розгорнуті збіги, нічого не згорнуто вручну).
                key={narrowing ? `n:${q}:${filter}` : 'all'}
                zones={zones}
                stateOf={stateOf}
                phone={phone}
                ahead={Infinity}
                flagsOnly
                allOpen={narrowing}
                allLink={false}
                focusZoneId={focusZone}
                scrollOnOpen
                renderBody={(z, st) => <ZoneDirectory zone={z} state={st} total={byId.get(z.id) ?? z} hits={hits} searching={narrowing} />}
              />
            )}
          </div>
        )}

        <Faq items={faqItems} columns={phone ? 1 : 2} className={styles.faq} />

        {chat.column}
        {chat.dock}
      </div>
    </MapScheduleContext.Provider>
  );
}
