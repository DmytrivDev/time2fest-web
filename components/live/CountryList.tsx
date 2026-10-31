'use client';

/**
 * C19. «Країни й міста» (S-COUNTRIES / S-LIST, T093).
 *
 * Зверху вниз: `h1` і підзаголовок з датою й часом за часом гостя · рядок «Мапа / Список · Фільтри» (перемикач — лише
 * на телефоні; на десктопі мапа завжди праворуч від списку) · пошук · «Лише з трансляціями» і «У моєму графіку» ·
 * групи поясів (`ZoneGroup`): «Зараз наживо», «Далі» — розгорнуті; «Ще попереду», «Уже зустріли» — згорнуті пояси ·
 * «Питання й відповіді». Фільтри статусів — `FiltersSheet` (аркуш; змінюються одразу, кнопка «Показати N країн» лише закриває).
 *
 * Відліків у рядках немає — лише час за часом гостя. Назви країн — у називному відмінку.
 * Поки час невідомий (`useTimeReady()`), замість груп — скелетони; групи залежать від «зараз» з точністю до хвилини.
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Faq, type FaqItem } from '@/components/live/Faq';
import { buildMapModel, type ZoneMapGeometry } from '@/components/live/MapModel';
import { ZoneMap } from '@/components/live/ZoneMap';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Checkbox } from '@/components/primitives/Checkbox';
import { Chip } from '@/components/primitives/Chip';
import { cn } from '@/components/primitives/cn';
import { Collapsible } from '@/components/primitives/Collapsible';
import { Flag } from '@/components/primitives/Flag';
import { IconButton } from '@/components/primitives/IconButton';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Sheet } from '@/components/primitives/Sheet';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { TextField } from '@/components/primitives/TextField';
import { getData } from '@/lib/data/load';
import type { Dataset, Ms } from '@/lib/data/types';
import { formatAgo, formatClock, formatTimeForViewer, viewerZoneLabel } from '@/lib/i18n/time';
import {
  ALL_STATUSES,
  allStatuses,
  buildZones,
  countShown,
  filterZones,
  filtersBadge,
  isQuickSet,
  minutesUntil,
  quickStatuses,
  rowInSchedule,
  splitZones,
  statusCounts,
  type CountryRowData,
  type RowStatus,
  type ZoneData,
} from '@/lib/live/countriesData';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import styles from './countryList.module.css';

/** Скільки рядків країн показує розгорнутий пояс до «Ще N країн поясу». */
const ROW_LIMIT = 6;
/** Скільки назв країн у згорнутому поясі до «ще N». */
const NAMES_IN_SUMMARY = 3;

const STATUS_KEY = { live: 'live', expected: 'expected', possible: 'possible', 'countdown-only': 'countdownOnly' } as const;
const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;

type Translate = ReturnType<typeof useTranslations>;

export interface CountryListProps {
  /** Геометрія мапи (`data/zonemap.json`); без неї підвантажується окремим шматком. */
  geometry?: ZoneMapGeometry;
  /** Кнопка графіка в рядку країни; без обробника кнопки немає (графік — US5). */
  onToggleSchedule?: (eventId: string, next: boolean) => void;
  /** Набір даних (за замовчуванням — `getData()`); для історій і тестів. */
  data?: Dataset;
  className?: string;
}

// ── Рядок країни ───────────────────────────────────────────────────────────

interface CountryRowProps {
  row: CountryRowData;
  /** Пояс уже зустрів Новий рік: статус трансляції не показуємо (атрибут лишається). */
  past: boolean;
  inSchedule: boolean;
  onToggleSchedule?: ((eventId: string, next: boolean) => void) | undefined;
}

/** C19 `CountryRow`: прапор, країна, «Лондон · Головне святкування», статус (іконка + текст); рядок веде на сторінку країни. */
function CountryRow({ row, past, inSchedule, onToggleSchedule }: CountryRowProps) {
  const tType = useTranslations('liveCards.eventCard.type');
  const tNav = useTranslations('nav');
  const line =
    row.celebrationType === 'countdown-only' || !row.city
      ? row.city
      : `${row.city} · ${tType(TYPE_KEY[row.celebrationType])}`;
  const eventId = row.eventIds[0];
  return (
    <li data-country-row={row.iso} data-status={row.status} className="relative">
      <NextLink
        href={row.href}
        className={cn(
          't2f-focus t2f-transition flex min-h-touch-min items-center gap-3 rounded-md py-2 ps-2 text-text no-underline hover:bg-surface-raised',
          onToggleSchedule && eventId && !past ? 'pe-14' : 'pe-2',
        )}
      >
        <Flag code={row.flagCode} size="sm" decorative />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-strong">{row.name}</span>
          {line ? <span className="truncate text-caption text-text-muted">{line}</span> : null}
        </span>
        {inSchedule ? <Badge variant="in-schedule" className="shrink-0" /> : null}
        {past ? null : <Badge variant="stream-status" status={row.status} className="shrink-0" />}
      </NextLink>
      {onToggleSchedule && eventId && !past ? (
        <ScheduleToggle label={tNav(inSchedule ? 'addedToSchedule' : 'addToSchedule', { city: row.city || row.name })} pressed={inSchedule} onChange={(next) => onToggleSchedule(eventId, next)} />
      ) : null}
    </li>
  );
}

function ScheduleToggle({ label, pressed, onChange }: { label: string; pressed: boolean; onChange: (next: boolean) => void }) {
  return (
    <IconButton
      variant="toggle"
      compact
      icon={pressed ? 'calendar-check' : 'calendar-add'}
      aria-label={label}
      pressed={pressed}
      onPressedChange={onChange}
      className="absolute end-1 top-0"
    />
  );
}

// ── Рядки поясу ────────────────────────────────────────────────────────────

interface ZoneRowsProps {
  zone: ZoneData;
  past: boolean;
  schedule: readonly string[];
  /** Показати всі рядки (активний пошук). */
  showAll: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleSchedule?: ((eventId: string, next: boolean) => void) | undefined;
}

function ZoneRows({ zone, past, schedule, showAll, expanded, onToggleExpanded, onToggleSchedule }: ZoneRowsProps) {
  const t = useTranslations('countries');
  const tCommon = useTranslations('common');
  const open = showAll || expanded;
  const shown = open ? zone.rows : zone.rows.slice(0, ROW_LIMIT);
  const hidden = zone.rows.length - ROW_LIMIT;
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {shown.map((row) => (
          <CountryRow key={row.iso} row={row} past={past} inSchedule={rowInSchedule(row, schedule)} onToggleSchedule={onToggleSchedule} />
        ))}
      </ul>
      {!showAll && hidden > 0 ? (
        <div>
          <Chip variant="more" expanded={expanded} onClick={onToggleExpanded}>
            {expanded ? tCommon('collapse') : t('moreInZone', { count: hidden })}
          </Chip>
        </div>
      ) : null}
    </div>
  );
}

// ── Підписи часу ───────────────────────────────────────────────────────────

/** «02:00» або «1 січня, 02:00», якщо день півночі відрізняється від сьогоднішнього для гостя. */
function whenParts(ms: Ms, now: Ms): { time: string; date: string | null } {
  const v = formatTimeForViewer(ms, { now });
  return { time: v.time, date: v.date };
}

function midnightLabel(t: Translate, ms: Ms, now: Ms): string {
  const { time, date } = whenParts(ms, now);
  return date ? t('midnightAtDate', { date, time }) : t('midnightAt', { time });
}

function namesLine(t: Translate, rows: readonly CountryRowData[]): string {
  const names = rows.slice(0, NAMES_IN_SUMMARY).map((r) => r.name);
  const rest = rows.length - names.length;
  return rest > 0 ? `${names.join(' · ')} · ${t('alsoNames', { count: rest })}` : names.join(' · ');
}

// ── Група поясів ───────────────────────────────────────────────────────────

interface GroupShared {
  now: Ms;
  schedule: readonly string[];
  query: string;
  expandedRows: ReadonlySet<string>;
  openZones: ReadonlySet<string>;
  toggleRows: (zoneId: string) => void;
  toggleOpen: (zoneId: string) => void;
  onToggleSchedule?: ((eventId: string, next: boolean) => void) | undefined;
}

/** Розгорнутий пояс «Зараз наживо» / «Далі»: заголовок `h2`, UTC, рядки країн. */
function CurrentGroup({ kind, zone, shared }: { kind: 'live' | 'next'; zone: ZoneData; shared: GroupShared }) {
  const t = useTranslations('countries');
  const tNav = useTranslations('nav');
  const headingId = useId();
  const { now } = shared;
  let ahead: string | null = null;
  if (kind === 'next') {
    const total = minutesUntil(zone.midnightMs, now);
    const hours = Math.floor(total / 60);
    ahead = hours > 0 ? t('inHoursMinutes', { hours, minutes: total % 60 }) : tNav('inMinutes', { minutes: total });
  }
  return (
    <section data-zone-group={kind} aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-headline-sm text-text">
        {t(`group.${kind}`)}
        <span className="text-body text-text-secondary">
          {' · '}
          {midnightLabel(t, zone.midnightMs, now)}
          {' · '}
          {tNav('countriesCount', { count: zone.rows.length })}
        </span>
      </h2>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <p className="m-0 flex items-center justify-between gap-3 text-caption text-text-muted">
          <span>{zone.utc}</span>
          {ahead ? <span>{ahead}</span> : null}
        </p>
        <ZoneRows
          zone={zone}
          past={false}
          schedule={shared.schedule}
          showAll={shared.query !== ''}
          expanded={shared.expandedRows.has(zone.id)}
          onToggleExpanded={() => shared.toggleRows(zone.id)}
          onToggleSchedule={shared.onToggleSchedule}
        />
      </div>
    </section>
  );
}

/** «Ще попереду» / «Уже зустріли»: список згорнутих поясів (Collapsible), що розкриваються кнопкою. */
function CollapsedGroup({ kind, zones, shared }: { kind: 'later' | 'met'; zones: readonly ZoneData[]; shared: GroupShared }) {
  const t = useTranslations('countries');
  const tNav = useTranslations('nav');
  const headingId = useId();
  const { now } = shared;
  const first = zones[0];
  const last = zones[zones.length - 1];
  const searching = shared.query !== '';
  const caption =
    kind === 'later'
      ? `${t('zonesCount', { count: zones.length })} · ${t('range', { from: first?.utc ?? '', to: last?.utc ?? '' })}`
      : t('range', { from: first?.utc ?? '', to: last?.utc ?? '' });
  return (
    <section data-zone-group={kind} aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex flex-col">
        <h2 id={headingId} className="text-headline-sm text-text">
          {kind === 'met' ? t('group.met', { count: zones.length }) : t('group.later')}
        </h2>
        <p className="m-0 text-caption text-text-muted">{caption}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {zones.map((zone) => {
          const { time, date } = whenParts(zone.midnightMs, now);
          const clock = kind === 'later' ? (date ? `${date}, ${t('zoneAt', { time })}` : t('zoneAt', { time })) : date ? `${date}, ${time}` : time;
          const detail =
            kind === 'later'
              ? tNav('countriesCount', { count: zone.rows.length })
              : formatAgo(Math.max(0, now - zone.midnightMs));
          return (
            <li key={zone.id} data-zone={zone.id}>
              <Collapsible
                open={searching || shared.openZones.has(zone.id)}
                onOpenChange={() => shared.toggleOpen(zone.id)}
                title={
                  <span className="flex flex-col py-1.5">
                    <span>{clock}</span>
                    <span className="text-caption font-normal text-text-secondary">{namesLine(t, zone.rows)}</span>
                  </span>
                }
                meta={t('zoneMeta', { detail, utc: zone.utc })}
              >
                <ZoneRows
                  zone={zone}
                  past={kind === 'met'}
                  schedule={shared.schedule}
                  showAll={searching}
                  expanded={shared.expandedRows.has(zone.id)}
                  onToggleExpanded={() => shared.toggleRows(zone.id)}
                  onToggleSchedule={shared.onToggleSchedule}
                />
              </Collapsible>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Фільтри ────────────────────────────────────────────────────────────────

interface FiltersSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: ReadonlySet<RowStatus>;
  onStatusesChange: (next: Set<RowStatus>) => void;
  counts: Record<RowStatus, number>;
  shown: number;
}

/** Тіло аркуша: окремий компонент, щоб коралова кнопка реєструвалась, лише поки аркуш відкритий. */
function FiltersBody({ onOpenChange, statuses, onStatusesChange, counts, shown }: Omit<FiltersSheetProps, 'open'>) {
  const t = useTranslations('countries');
  const tBadge = useTranslations('primitives.badge');
  useRegisterCoral();
  const none = statuses.size === 0;
  const toggle = (s: RowStatus, on: boolean) => {
    const next = new Set(statuses);
    if (on) next.add(s);
    else next.delete(s);
    onStatusesChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
        <legend className="mb-1 p-0 text-label-sm text-text-secondary">{t('statusHeading')}</legend>
        {ALL_STATUSES.map((s) => (
          <Checkbox
            key={s}
            label={tBadge(`status.${STATUS_KEY[s]}`)}
            count={counts[s]}
            checked={statuses.has(s)}
            onCheckedChange={(v) => toggle(s, v === true)}
          />
        ))}
      </fieldset>
      {none ? <p className="m-0 text-caption text-text-muted">{t('pickStatus')}</p> : null}
      <div className="flex flex-col gap-2">
        <Button variant="coral" size="lg" disabled={none} onClick={() => onOpenChange(false)}>
          {t('show', { count: shown })}
        </Button>
        <Button variant="ghost" onClick={() => onStatusesChange(allStatuses())}>
          {t('reset')}
        </Button>
      </div>
    </div>
  );
}

/** C19 `FiltersSheet`: прапорці статусів із лічильниками, «Показати N країн», «Скинути». */
export function FiltersSheet({ open, onOpenChange, ...body }: FiltersSheetProps) {
  const t = useTranslations('countries');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('filtersTitle')} className="md:mx-auto md:max-w-xl">
      <FiltersBody onOpenChange={onOpenChange} {...body} />
    </Sheet>
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
      ready && firstZone && lastZone
        ? t('firstAnswerTimed', { first: at(firstZone.midnightMs), last: at(lastZone.midnightMs) })
        : t('firstAnswer');
    const london = ready && londonZone ? t('londonAnswerTimed', { time: at(londonZone.midnightMs) }) : t('londonAnswer');
    return [
      { id: 'first-country', question: tNav('faqFirstCountry'), answer: first },
      { id: 'london-time', question: t('londonQuestion'), answer: london },
      { id: 'why-different', question: t('whyQuestion'), answer: t('whyAnswer') },
    ];
  }, [data, now, ready, t, tNav]);
}

// ── Сторінка ───────────────────────────────────────────────────────────────

/** Сторінка «Країни й міста»: заголовок, керування, групи поясів, мапа поясів, «Питання й відповіді». */
export function CountryList({ geometry, onToggleSchedule, data: dataProp, className }: CountryListProps) {
  const t = useTranslations('countries');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const ready = useTimeReady();
  const now = useNow({ granularity: 'minute' });
  const hasPass = useGuestStore((s) => s.hasPass);
  const schedule = useGuestStore((s) => s.schedule);
  const data = dataProp ?? getData();

  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<Set<RowStatus>>(allStatuses);
  const [inScheduleOnly, setInScheduleOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const [openZones, setOpenZones] = useState<ReadonlySet<string>>(new Set());

  const flip = (set: ReadonlySet<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const mapModel = useMemo(() => buildMapModel(data), [data]);
  const zones = useMemo(() => (ready ? buildZones(data, now) : []), [data, now, ready]);
  const counts = useMemo(() => statusCounts(zones), [zones]);
  const showSchedule = hasPass && schedule.length > 0;
  const inSchedule = showSchedule && inScheduleOnly;
  const shownCount = useMemo(() => countShown(zones, statuses, inSchedule, schedule), [zones, statuses, inSchedule, schedule]);
  const groups = useMemo(() => {
    const filtered = filterZones(zones, { statuses, inSchedule, query }, schedule);
    // Часові групи — за всіма поясами (не за відфільтрованими), щоб «Зараз наживо» не стрибало від пошуку.
    const split = splitZones(zones, now);
    const keep = new Map(filtered.map((z) => [z.id, z]));
    const pick = (z: ZoneData | null) => (z ? (keep.get(z.id) ?? null) : null);
    const pickAll = (list: readonly ZoneData[]) => list.map((z) => keep.get(z.id)).filter((z): z is ZoneData => z !== undefined);
    return { live: pick(split.live), next: pick(split.next), later: pickAll(split.later), met: pickAll(split.met), total: filtered.length };
  }, [zones, now, statuses, inSchedule, query, schedule]);

  const badge = filtersBadge(statuses);
  const quick = isQuickSet(statuses);
  const searching = query.trim() !== '';

  const shared: GroupShared = {
    now,
    schedule,
    query: query.trim(),
    expandedRows,
    openZones,
    toggleRows: (id) => setExpandedRows((s) => flip(s, id)),
    toggleOpen: (id) => setOpenZones((s) => flip(s, id)),
    onToggleSchedule,
  };

  const zoneLabel = viewerZoneLabel();
  const subtitle = ready
    ? t('subtitle', {
        zone: zoneLabel,
        date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(now),
        time: formatClock(now, { locale }),
      })
    : t('subtitleStatic');

  const faqItems = useFaqItems(data, now, ready);

  let emptyText: string | null = null;
  if (ready && groups.total === 0) {
    emptyText = searching ? t('empty') : statuses.size === 0 ? t('emptyStatuses') : t('emptyFilters');
  }

  return (
    <div data-countries-page="" className={cn(styles.page, 'flex flex-col gap-6 pb-8 pt-4', className)}>
      <header className="flex flex-col gap-1">
        <h1 className="text-headline-md text-text">{t('title')}</h1>
        <p className="m-0 text-body text-text-secondary">{subtitle}</p>
      </header>

      <div className={styles.cols} data-view={view}>
        <div className={styles.listCol}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label={t('viewLabel')}
              semantics="pressed"
              value={view}
              onValueChange={(v) => setView(v === 'map' ? 'map' : 'list')}
              options={[
                { value: 'map', label: tNav('mapShort') },
                { value: 'list', label: tNav('list') },
              ]}
              className={styles.phoneOnly}
            />
            <Button variant="secondary" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              {badge === null ? t('filters') : t('filtersCount', { count: badge })}
            </Button>
          </div>

          <div className={styles.listBody}>
            <TextField
              type="search"
              label={t('searchLabel')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              enterKeyHint="search"
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Switch
                label={tNav('onlyWithStreams')}
                checked={quick}
                onCheckedChange={(on) => setStatuses(on ? quickStatuses() : allStatuses())}
              />
              {showSchedule ? (
                <Chip variant="filter" selected={inScheduleOnly} onSelectedChange={setInScheduleOnly}>
                  {tNav('mySchedule')}
                </Chip>
              ) : null}
            </div>

            <div className="flex flex-col gap-6" aria-label={t('listLabel')} role="region" aria-busy={!ready || undefined}>
              {!ready ? (
                <div className="flex flex-col gap-3">
                  <span className="sr-only">{tCommon('loading')}</span>
                  <Skeleton variant="block" className="h-48" />
                  <Skeleton variant="block" className="h-24" />
                  <Skeleton variant="block" className="h-16" />
                </div>
              ) : null}
              {emptyText ? (
                <p role="status" className="m-0 rounded-md bg-surface p-4 text-body text-text-secondary">
                  {emptyText}
                </p>
              ) : null}
              {groups.live ? <CurrentGroup kind="live" zone={groups.live} shared={shared} /> : null}
              {groups.next ? <CurrentGroup kind="next" zone={groups.next} shared={shared} /> : null}
              {groups.later.length ? <CollapsedGroup kind="later" zones={groups.later} shared={shared} /> : null}
              {groups.met.length ? <CollapsedGroup kind="met" zones={groups.met} shared={shared} /> : null}
            </div>
          </div>
        </div>

        <div className={styles.mapPane}>
          <ZoneMap {...mapModel} {...(geometry ? { geometry } : {})} />
        </div>
      </div>

      <Faq items={faqItems} columns={2} />

      <FiltersSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        statuses={statuses}
        onStatusesChange={setStatuses}
        counts={counts}
        shown={shownCount}
      />
    </div>
  );
}
