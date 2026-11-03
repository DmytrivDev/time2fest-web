'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Reveal } from '@/components/primitives/Reveal';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatClock } from '@/lib/i18n/time';
import { StateSwatch } from './MapSide';
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
}

/**
 * Вкладка «Список» біля мапи (рішення власника 2026-11-03, дошка `Desk-Map-ListView`, варіант C): пояс, що зараз наживо,
 * і п’ять найближчих; рядок — як на сторінці «Країни й міста», клік розгортає його на місці з умістом вікна поясу
 * (без стрілок і «×»). Відкритий один пояс; на старті — той, що наживо, і він іде за північчю. Далі — згорнуті «Вже
 * зустріли» й посилання на сторінку з усіма поясами.
 */
export function ZoneListView({ zones, stateOf, phone }: ZoneListViewProps) {
  const t = useTranslations('liveMap.list');
  const uid = useId();
  // За часом опівночі: спершу ті, що попереду (найближчий — першим), потім минулі.
  const byMidnight = [...zones].sort((a, b) => a.midnightMs - b.midnightMs);
  const startIdx = byMidnight.findIndex((z) => stateOf(z.id) !== 'past');
  const shown = startIdx < 0 ? [] : byMidnight.slice(startIdx, startIdx + 1 + AHEAD);
  const past = (startIdx < 0 ? byMidnight : byMidnight.slice(0, startIdx)).reverse();
  const leadId = shown[0]?.id ?? null;
  // `auto` — відкритий пояс, що зараз перший (наживо); клік фіксує вибір, повторний — згортає.
  const [picked, setPicked] = useState<string | null | 'auto'>('auto');
  const openId = picked === 'auto' ? leadId : picked;
  const [pastOpen, setPastOpen] = useState(false);
  const toggle = (id: string) => setPicked(openId === id ? null : id);
  const row = (z: MapZone) => (
    <ZoneRow key={z.id} zone={z} state={stateOf(z.id)} phone={phone} open={openId === z.id} onToggle={() => toggle(z.id)} panelId={`${uid}-${z.id}`} />
  );
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
                {utcLabel(past[0]!.offsetMinutes)} … {utcLabel(past[past.length - 1]!.offsetMinutes)}
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
      <NextLink href={COUNTRIES_HREF} className={cn('t2f-focus', m.all)} data-zone-list-all="">
        {t('all')}
        <Icon name="arrow-right" size={16} />
      </NextLink>
    </div>
  );
}

function ZoneRow({
  zone,
  state,
  phone,
  open,
  onToggle,
  panelId,
}: {
  zone: MapZone;
  state: ZoneState;
  phone: boolean;
  open: boolean;
  onToggle: () => void;
  panelId: string;
}) {
  const t = useTranslations('liveMap.list');
  const locale = useLocale();
  const offset = utcLabel(zone.offsetMinutes);
  const time = formatClock(zone.midnightMs, { locale });
  const first = [...zone.countries.filter((c) => !NOT_FIRST.has(c.iso)), ...zone.countries.filter((c) => NOT_FIRST.has(c.iso))];
  const names = first.slice(0, DESK_NAMES).map((c) => c.name);
  const moreNames = zone.countries.length - names.length;
  const flags = first.slice(0, phone ? PHONE_FLAGS : DESK_NAMES);
  const moreFlags = zone.countries.length - flags.length;
  const tag = state === 'live' ? t('now') : state === 'next' ? t('next') : null;
  const flagStack = (
    <span className={m.flags} aria-hidden="true">
      {flags.map((c) => (
        <span key={c.iso} className={m.flag}>
          <Flag code={c.flagCode} round diameter={20} decorative />
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
      <button type="button" className={cn('t2f-focus', m.head)} aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
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
              {moreFlags > 0 ? <span className={m.more}>{t('more', { count: moreFlags })}</span> : null}
            </span>
          </>
        ) : (
          <>
            {when}
            <span className={m.tagSlot}>{tag ? <span className={cn(m.tag, m[`tag_${state}`])}>{tag}</span> : null}</span>
            {flagStack}
            <span className={m.names}>
              {names.join(' · ')}
              {moreNames > 0 ? ` · ${t('more', { count: moreNames })}` : ''}
            </span>
            <span className={m.meta}>{t('countries', { count: zone.countries.length })}</span>
            <span className={cn(m.meta, m.utc)}>{offset}</span>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className={m.chev} />
          </>
        )}
      </button>
      <Reveal open={open}>
        <div id={panelId}>
          {/* Уміст вікна поясу з мапи — той самий компонент, без шапки (сусіди — рядки поруч, згорнути — клік по рядку). */}
          <ZonePanel zone={zone} state={state} phone={phone} embedded onSelect={() => undefined} onClose={onToggle} />
        </div>
      </Reveal>
    </li>
  );
}
