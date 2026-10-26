'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type Ref } from 'react';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Countdown } from '@/components/primitives/Countdown';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { TimeText } from '@/components/primitives/TimeText';
import { formatTimeForViewer } from '@/lib/i18n/time';
import type { ZoneState } from '@/lib/engine/zoneState';
import { useNow } from '@/lib/time/TimeProvider';
import { utcLabel, type MapCity, type MapCountry, type MapZone } from './MapModel';

const STATE_ICON: Record<ZoneState, IconName | null> = { past: 'check', live: null, next: 'clock', future: null };

/** Стан поясу текстом (+ іконка): колір ніколи не єдина ознака. «Наживо» — стандартна позначка. */
export function ZoneStateLabel({ state, className }: { state: ZoneState; className?: string }) {
  const t = useTranslations('liveMap.legend');
  const tBadge = useTranslations('primitives.badge');
  if (state === 'live') return <Badge variant="live" className={className}>{tBadge('live')}</Badge>;
  const icon = STATE_ICON[state];
  return (
    <span data-zone-state-label={state} className={cn('inline-flex items-center gap-1.5 text-label-sm text-text-secondary', className)}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {t(state)}
    </span>
  );
}

/** «північ о 02:00 за вашим часом» (з датою, якщо це інший день). */
export function useMidnightPhrase(midnightMs: number): string {
  const t = useTranslations('liveMap');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });
  const v = formatTimeForViewer(midnightMs, { now: now > 0 ? now : midnightMs, locale });
  return v.date ? t('midnightAtDate', { date: v.date, time: v.time }) : t('midnightAt', { time: v.time });
}

function useCountries(list: readonly MapCountry[], max: number) {
  const [expanded, setExpanded] = useState(false);
  const hidden = Math.max(0, list.length - max);
  return { shown: expanded || hidden === 0 ? list : list.slice(0, max), hidden, expanded, toggle: () => setExpanded((v) => !v) };
}

/** C18 `HowToPopover`: 2–3 традиції країни поясу; Esc закриває й повертає фокус на кнопку (Radix). */
export function HowToPopover({ country, className }: { country: MapCountry; className?: string }) {
  const t = useTranslations('liveMap');
  const tNav = useTranslations('nav');
  const tHow = useTranslations('liveCards.howTo');
  const traditions = country.traditions ?? [];
  if (traditions.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" compact iconLeft="info" className={className}>
          {tNav('howToShort')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-sm" data-how-to-popover="">
        <h4 className="text-headline-sm text-text">{tHow('title', { country: country.name })}</h4>
        <ul className="mt-2 flex flex-col gap-2">
          {traditions.map((x) => (
            <li key={x.id}>
              <p className="text-body-strong text-text">{x.title}</p>
              <p className="text-caption text-text-secondary">{x.text}</p>
            </li>
          ))}
        </ul>
        <NextLink
          href={country.href}
          className="t2f-focus mt-3 inline-flex min-h-touch-min items-center gap-1 rounded-sm text-body-strong text-text underline underline-offset-2"
        >
          {t('openCountry')}
          <Icon name="chevron-right" size={16} />
        </NextLink>
      </PopoverContent>
    </Popover>
  );
}

export interface ZoneCardProps {
  zone: MapZone;
  state: ZoneState;
  /** Закріплена (Enter / клік / дотик): з × і посиланнями. Інакше — попередній перегляд при наведенні, без дій. */
  pinned?: boolean;
  onClose?: () => void;
  /** Скільки країн показати до «Ще N». */
  maxCountries?: number;
  ref?: Ref<HTMLElement>;
  className?: string;
}

/** C18 `ZoneCard`: назва поясу з UTC (єдине місце, де є UTC), час, відлік, країни-посилання, «Як святкувати». */
export function ZoneCard({ zone, state, pinned = true, onClose, maxCountries = 8, ref, className }: ZoneCardProps) {
  const t = useTranslations('liveMap');
  const now = useNow({ granularity: 'minute' });
  const when = useMidnightPhrase(zone.midnightMs);
  const { shown, hidden, expanded, toggle } = useCountries(zone.countries, maxCountries);
  const future = zone.midnightMs > now;
  const titleId = `zone-card-${zone.id}`;
  const first = zone.countries[0];

  return (
    <section
      ref={ref}
      aria-labelledby={pinned ? titleId : undefined}
      aria-hidden={pinned ? undefined : true}
      data-zone-card={pinned ? 'pinned' : 'preview'}
      data-zone-id={zone.id}
      data-state={state}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-surface p-4',
        pinned ? 'border-border-strong' : 'border-border',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <h3 id={titleId} className="min-w-0 flex-1 text-headline-sm text-text">
          {t('zoneName', { offset: utcLabel(zone.offsetMinutes) })}
        </h3>
        <ZoneStateLabel state={state} />
        {pinned && onClose ? <IconButton icon="close" variant="plain" aria-label={t('closeCard')} onClick={onClose} /> : null}
      </div>
      <p className="text-body text-text">{when}</p>
      {now > 0 ? (
        future ? (
          <Countdown target={zone.midnightMs} variant="inline" label={t('untilMidnight')} />
        ) : (
          <p className="text-caption text-text-secondary">
            <TimeText at={zone.midnightMs} variant="relative" midnight />
          </p>
        )
      ) : null}
      <div>
        <h4 className="text-label-sm text-text-secondary">{t('countriesOfZone')}</h4>
        {pinned ? (
          <ul className="mt-1 flex flex-wrap gap-2">
            {shown.map((c) => (
              <li key={c.iso}>
                <NextLink
                  href={c.href}
                  className="t2f-focus t2f-transition inline-flex min-h-touch-min items-center gap-2 rounded-full border border-border-strong bg-surface px-3 text-label-sm text-text hover:bg-surface-raised"
                >
                  <Flag code={c.flagCode} size="xs" decorative />
                  {c.name}
                </NextLink>
              </li>
            ))}
            {hidden > 0 ? (
              <li>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={toggle}
                  className="t2f-focus t2f-transition inline-flex min-h-touch-min items-center gap-1 rounded-full border border-border-strong px-3 text-label-sm text-text-secondary hover:bg-surface-raised"
                >
                  {expanded ? t('showFewerCountries') : t('showMoreCountries', { count: hidden })}
                  <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-body text-text-secondary">{zone.countries.map((c) => c.name).join(', ')}</p>
        )}
      </div>
      {pinned && first ? <HowToPopover country={first} className="self-start" /> : null}
      {!pinned ? <p className="text-caption text-text-muted">{t('previewHint')}</p> : null}
    </section>
  );
}

export interface MapTapCardProps {
  city: MapCity;
  country: MapCountry;
  zone: MapZone;
  state: ZoneState;
  /** «Головне святкування» / «Вебкамера» / «Лише відлік» (з `liveCards.eventCard.type`). */
  typeLabel: string;
  onClose: () => void;
  ref?: Ref<HTMLElement>;
  className?: string;
}

/** C18 `MapTapCard` (телефон): картка країни під мапою; перехід лише за «Відкрити країну». */
export function MapTapCard({ city, country, zone, state, typeLabel, onClose, ref, className }: MapTapCardProps) {
  const t = useTranslations('liveMap');
  const when = useMidnightPhrase(zone.midnightMs);
  const others = zone.countries.filter((c) => c.iso !== country.iso);
  const names = others
    .slice(0, 4)
    .map((c) => c.name)
    .join(', ');
  const titleId = `map-card-${city.id}`;
  const rest = Math.max(0, others.length - 4);

  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      aria-live="polite"
      data-map-tap-card=""
      data-city-id={city.id}
      data-state={state}
      className={cn('flex flex-col gap-2 rounded-lg border border-border-strong bg-surface py-3 pe-1 ps-4', className)}
    >
      <div className="flex items-center gap-2.5">
        <Flag code={country.flagCode} size="md" decorative />
        <h3 id={titleId} className="min-w-0 flex-1 text-headline-sm text-text">
          {country.name}
        </h3>
        <IconButton icon="close" variant="plain" aria-label={t('closeCard')} onClick={onClose} />
      </div>
      <div className="flex flex-col gap-1 pe-3">
        <div className="flex min-w-0 items-center gap-2">
          <ZoneStateLabel state={state} />
          <span className="min-w-0 truncate text-body-strong text-text">{t('cityLine', { city: city.name, type: typeLabel })}</span>
        </div>
        <p className="text-caption text-text-secondary">{t('zoneLine', { offset: utcLabel(zone.offsetMinutes), when })}</p>
        {others.length > 0 ? (
          <p className="text-caption text-text-secondary">
            {rest > 0 ? t('alsoInZoneMore', { countries: names, count: rest }) : t('alsoInZone', { countries: names })}
          </p>
        ) : null}
      </div>
      <div className="pe-3 pt-1">
        <Button asChild variant="tonal" className="w-full">
          <NextLink href={country.href}>
            {t('openCountry')}
            <Icon name="chevron-right" size={16} />
          </NextLink>
        </Button>
      </div>
    </section>
  );
}
