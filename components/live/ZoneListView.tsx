'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Reveal } from '@/components/primitives/Reveal';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { CountryPanel } from './CountryPanel';
import { PanelSwap } from './PanelSwap';
import { StateSwatch } from './MapSide';
import { isReducedMotionNow } from '@/lib/a11y/reducedMotion';
import { utcLabel, type MapZone } from './MapModel';
import { ZonePanel } from './ZonePanel';
import m from './zoneList.module.css';

/** Скільки поясів після того, що наживо (рішення власника 2026-11-03). */
const AHEAD = 5;
/** Як у вікні поясу: Росія й Білорусь — не серед перших назв. */
const NOT_FIRST = new Set(['RU', 'BY']);
const DESK_NAMES = 3;
const PHONE_FLAGS = 5;

export const COUNTRIES_HREF = '/countries/';

export interface ZoneListViewProps {
  /** Усі пояси, від найсхіднішого (UTC+14) до найзахіднішого. */
  zones: readonly MapZone[];
  stateOf: (id: string) => ZoneState;
  phone: boolean;
  /** Скільки поясів після першого, що ще попереду (`Infinity` — усі; сторінка «Країни й міста»). */
  ahead?: number;
  /** Десктоп: у рядку п’ять прапорців і «ще N» замість назв (як на телефоні; сторінка «Країни й міста»). */
  flagsOnly?: boolean;
  /** Пошук: усі передані пояси одним списком по черзі, кожен розгорнутий (згорнути можна); без блоку «Вже зустріли». */
  allOpen?: boolean;
  /** Свій уміст розгорнутого рядка (за замовчуванням — вікно поясу, а з кліком по країні — вікно країни). */
  renderBody?: (zone: MapZone, state: ZoneState) => ReactNode;
  /** Посилання «Усі пояси й країни» внизу (на самій сторінці «Країни й міста» — ні). */
  allLink?: boolean;
  /** Розгорнути цей пояс і прокрутити до нього (посилання «Усі країни поясу ›» зі сторінки країни). */
  focusZoneId?: string | null;
  /**
   * Після розгортання поясу — плавна прокрутка сторінки до його заголовка під липкою шапкою (сторінка «Країни й міста»,
   * власник 2026-11-10: інакше, коли згортається великий пояс вище, сторінку «кидає незрозуміло куди»).
   */
  scrollOnOpen?: boolean;
}

/** Нижній край липких / фіксованих елементів угорі вікна (шапка тощо). */
function stickyTopOffset(): number {
  let bottom = 0;
  if (typeof document.elementsFromPoint !== 'function') return 0;
  const x = Math.round(window.innerWidth / 2);
  for (const el of document.elementsFromPoint(x, 1) ?? []) {
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'sticky' || pos === 'fixed') {
        const r = n.getBoundingClientRect();
        if (r.top <= 1 && r.bottom > bottom && r.height < window.innerHeight / 2) bottom = r.bottom;
        break;
      }
    }
  }
  return bottom;
}

/**
 * Прокрутити до рядка поясу `li` так, щоб заголовок став під шапкою. `collapsing` — рядок, що зараз згортається: якщо він
 * вище, його висота зникне під час анімації, тож ціль рахуємо наперед (кінцеве положення), і прокрутка йде разом зі згортанням.
 */
function scrollToRow(li: HTMLElement, collapsing: HTMLElement | null) {
  let top = li.getBoundingClientRect().top + window.scrollY;
  if (collapsing && collapsing !== li && collapsing.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING) {
    const reveal = collapsing.querySelector<HTMLElement>(':scope > .t2f-reveal');
    top -= reveal?.getBoundingClientRect().height ?? 0;
  }
  if (typeof window.scrollTo !== 'function') return;
  window.scrollTo({ top: Math.max(0, top - stickyTopOffset() - 8), behavior: isReducedMotionNow() ? 'auto' : 'smooth' });
}

/**
 * Вкладка «Список» біля мапи (рішення власника 2026-11-03, дошка `Desk-Map-ListView`, варіант C): пояс, що зараз наживо,
 * і п’ять найближчих; рядок — як на сторінці «Країни й міста», клік розгортає його на місці з умістом вікна поясу
 * (без стрілок і «×»). Відкритий один пояс; на старті — той, що наживо, і він іде за північчю. Далі — згорнуті «Вже
 * зустріли» й посилання на сторінку з усіма поясами.
 */
export function ZoneListView({
  zones,
  stateOf,
  phone,
  ahead = AHEAD,
  flagsOnly = false,
  allOpen = false,
  renderBody,
  allLink = true,
  focusZoneId = null,
  scrollOnOpen = false,
}: ZoneListViewProps) {
  const t = useTranslations('liveMap.list');
  const uid = useId();
  // За часом опівночі: спершу ті, що попереду (найближчий — першим), потім минулі.
  const byMidnight = [...zones].sort((a, b) => a.midnightMs - b.midnightMs);
  const startIdx = byMidnight.findIndex((z) => stateOf(z.id) !== 'past');
  const upcoming = startIdx < 0 ? [] : byMidnight.slice(startIdx, startIdx + 1 + ahead);
  const before = (startIdx < 0 ? byMidnight : byMidnight.slice(0, startIdx)).reverse();
  // Пошук: усе одним списком (спершу ті, що попереду), без «Вже зустріли».
  const shown = allOpen ? [...upcoming, ...before] : upcoming;
  const past = allOpen ? [] : before;
  // Пошук: розгорнуті всі; згорнуті вручну — тут.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // Спершу всі рядки згорнуті (правка власника 2026-11-04); клік розгортає один, повторний — згортає.
  const [openId, setOpenId] = useState<string | null>(null);
  // Клік по країні в розгорнутому рядку — вікно країни в тому самому рядку; «‹ До поясу» повертає пояс.
  const [countryIso, setCountryIso] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const now = useNow();
  const listed = new Set([...shown, ...past].map((z) => z.id));
  const rowOf = (id: string) => document.getElementById(`${uid}-${id}`)?.closest('li') ?? null;
  const toggle = (id: string) => {
    const opening = openId !== id;
    if (opening && scrollOnOpen) {
      const li = rowOf(id);
      if (li) scrollToRow(li, openId ? rowOf(openId) : null);
    }
    setOpenId(opening ? id : null);
    setCountryIso(null);
  };
  const openZone = (id: string, iso: string | null = null) => {
    if (!listed.has(id)) return;
    if (past.some((z) => z.id === id)) setPastOpen(true);
    setOpenId(id);
    setCountryIso(iso);
  };
  // Перехід зі сторінки країни («Усі країни поясу ›»): пояс розгорнуто, рядок — угорі екрана.
  useEffect(() => {
    if (!focusZoneId || allOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- пояс з адреси відомий лише після монтування
    openZone(focusZoneId);
    const id = window.requestAnimationFrame(() =>
      document.getElementById(`${uid}-${focusZoneId}`)?.parentElement?.scrollIntoView({ block: 'start' }),
    );
    return () => window.cancelAnimationFrame(id);
    // Лише коли змінюється сам пояс з посилання.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusZoneId]);
  const nextZone = zones.reduce<MapZone | undefined>(
    (best, z) => (z.midnightMs > now && (!best || z.midnightMs < best.midnightMs) ? z : best),
    undefined,
  );
  const row = (z: MapZone) => {
    const open = allOpen ? !closed.has(z.id) : openId === z.id;
    if (renderBody)
      return (
        <ZoneRow
          key={z.id}
          zone={z}
          state={stateOf(z.id)}
          phone={phone}
          flagsOnly={flagsOnly}
          open={open}
          onToggle={() => {
            if (!allOpen) return toggle(z.id);
            const next = new Set(closed);
            if (next.has(z.id)) next.delete(z.id);
            else next.add(z.id);
            setClosed(next);
          }}
          panelId={`${uid}-${z.id}`}
        >
          {renderBody(z, stateOf(z.id))}
        </ZoneRow>
      );
    const country = open && countryIso ? z.countries.find((c) => c.iso === countryIso) : undefined;
    return (
      <ZoneRow
        key={z.id}
        zone={z}
        state={stateOf(z.id)}
        phone={phone}
        open={open}
        onToggle={() => toggle(z.id)}
        panelId={`${uid}-${z.id}`}
      >
        <PanelSwap swapKey={country ? `c:${z.id}:${country.iso}` : `z:${z.id}`}>
          {country ? (
            <CountryPanel
              embedded
              takeFocus
              zone={z}
              country={country}
              state={stateOf(z.id)}
              zones={zones
                .filter((k) => k.countries.some((c) => c.iso === country.iso))
                .map((k) => ({ id: k.id, offsetMinutes: k.offsetMinutes, state: stateOf(k.id) }))}
              nextZone={nextZone}
              phone={phone}
              onSelectZone={(id) => openZone(id)}
              onSelectCountryZone={(id) => openZone(id, country.iso)}
              canSelectZone={(id) => listed.has(id)}
              onClose={() => setCountryIso(null)}
            />
          ) : (
            <ZonePanel
              zone={z}
              state={stateOf(z.id)}
              phone={phone}
              embedded
              onSelect={() => undefined}
              onSelectCountry={(iso) => setCountryIso(iso)}
              onClose={() => toggle(z.id)}
            />
          )}
        </PanelSwap>
      </ZoneRow>
    );
  };
  return (
    <div className={cn(m.list, phone && m.phone)} data-zone-list="">
      <ul className={m.rows} aria-label={t('aria')}>
        {shown.map(row)}
      </ul>
      {past.length ? (
        <div className={m.pastBox}>
          <button
            type="button"
            className={cn('t2f-focus', m.pastRow)}
            aria-expanded={pastOpen}
            aria-controls={`${uid}-past`}
            onClick={() => setPastOpen((v) => !v)}
            data-zone-list-past=""
          >
            <StateSwatch state="past" className={m.sw} />
            <span className={m.pastLabel}>{t('past', { count: past.length })}</span>
            {phone ? null : (
              <span className={m.meta}>
                {utcLabel(past[0]!.offsetMinutes)} …{' '}
                {utcLabel(past[past.length - 1]!.offsetMinutes)}
              </span>
            )}
            <Icon name={pastOpen ? 'chevron-up' : 'chevron-down'} size={16} className={m.chev} />
          </button>
          <Reveal open={pastOpen}>
            <ul id={`${uid}-past`} className={cn(m.rows, m.pastRows)}>
              {past.map(row)}
            </ul>
          </Reveal>
        </div>
      ) : null}
      {allLink ? (
        <NextLink href={COUNTRIES_HREF} className={cn('t2f-focus', m.all)} data-zone-list-all="">
          {t('all')}
          <Icon name="arrow-right" size={16} />
        </NextLink>
      ) : null}
    </div>
  );
}

export function ZoneRow({
  zone,
  state,
  phone,
  flagsOnly = false,
  open,
  onToggle,
  panelId,
  children,
}: {
  zone: MapZone;
  state: ZoneState;
  phone: boolean;
  flagsOnly?: boolean;
  open: boolean;
  onToggle: () => void;
  panelId: string;
  /** Уміст розгорнутого рядка: вікно поясу або (після кліку по країні) вікно країни. */
  children: ReactNode;
}) {
  const t = useTranslations('liveMap.list');
  const locale = useLocale();
  const offset = utcLabel(zone.offsetMinutes);
  const time = formatClock(zone.midnightMs, { locale });
  const first = [
    ...zone.countries.filter((c) => !NOT_FIRST.has(c.iso)),
    ...zone.countries.filter((c) => NOT_FIRST.has(c.iso)),
  ];
  const names = first.slice(0, DESK_NAMES).map((c) => c.name);
  const moreNames = zone.countries.length - names.length;
  const flags = first.slice(0, phone || flagsOnly ? PHONE_FLAGS : DESK_NAMES);
  const moreFlags = zone.countries.length - flags.length;
  const tag = state === 'live' ? t('now') : state === 'next' ? t('next') : null;
  const flagStack = (
    <span className={m.flags} aria-hidden="true">
      {flags.map((c) => (
        <span key={c.iso} className={m.flag}>
          <Flag code={c.flagCode} diameter={20} decorative />
        </span>
      ))}
    </span>
  );
  const when = phone ? (
    <>
      <span className={m.offset}>{offset}</span>
      <span className={m.dot} aria-hidden="true">
        ·
      </span>
      <span className={m.timePhone}>{t('at', { time })}</span>
    </>
  ) : (
    <span className={m.time}>{t('at', { time })}</span>
  );
  return (
    <li className={cn(m.item, open && m.itemOpen)} data-zone-row={zone.id} data-state={state}>
      <button
        type="button"
        className={cn('t2f-focus', m.head)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <StateSwatch state={state} className={m.sw} />
        {phone ? (
          <>
            <span className={m.line1}>
              {when}
              {tag ? <span className={cn(m.tag, m[`tag_${state}`])}>{tag}</span> : null}
            </span>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className={m.chev} />
            <span className={m.line2}>
              {flagStack}
              {moreFlags > 0 ? (
                <span className={m.more}>{t('more', { count: moreFlags })}</span>
              ) : null}
            </span>
          </>
        ) : (
          <>
            {when}
            <span className={m.tagSlot}>
              {tag ? <span className={cn(m.tag, m[`tag_${state}`])}>{tag}</span> : null}
            </span>
            {flagStack}
            {flagsOnly ? (
              <span className={m.names}>
                {moreFlags > 0 ? <span className={m.more}>{t('more', { count: moreFlags })}</span> : null}
              </span>
            ) : (
              <span className={m.names}>
                {names.join(' · ')}
                {moreNames > 0 ? ` · ${t('more', { count: moreNames })}` : ''}
              </span>
            )}
            <span className={m.meta}>{t('countries', { count: zone.countries.length })}</span>
            <span className={cn(m.meta, m.utc)}>{offset}</span>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className={m.chev} />
          </>
        )}
      </button>
      <Reveal open={open}>
        {/* Уміст вікна поясу чи країни з мапи — ті самі компоненти, без рамки (згорнути — клік по рядку). */}
        <div id={panelId}>{children}</div>
      </Reveal>
    </li>
  );
}
