'use client';

/**
 * C20 · CountryHeader — рядок країни (S-COUNTRY) за дошками `Desk-Country-Full`, `Phone-Country-Full` (рішення власника
 * 2026-11-05): невеликий, без фото.
 * Десктоп (без хлібних крихт — власник 2026-11-07; назва на рівні з верхом чату): круглий прапор, назва, «північ о 01:00 за вашим часом» і «Додати в графік»
 * (лише поки північ не минула). Країна з кількома поясами — під назвою стрічка поясів «UTC−5 · Нью-Йорк 07:00 …».
 * Телефон: рядок 60 px над відео — прапор, назва, «північ о …» (кілька поясів — кнопка «Нью-Йорк · UTC−5 · 07:00 ▾»,
 * шторка «Пояси …») і календарик. Поки розгорнуто чат чи відкрито шторку (`html[data-chat-dock-expanded]`), рядок плавно
 * складається: відео під’їжджає під шапку, висоти чату й шторок — як на головній; сторінка нікуди не прокручується.
 * `h1` — на сторінці (sr-only), тут назва — звичайний абзац. Назви — лише в називному відмінку.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { Country } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { ukOrdinal } from '@/lib/rating/rating';
import h from './countryHeader.module.css';
import m from './countryPanel.module.css';
import styles from './live.module.css';

export const ZONES_SHEET_ID = 'O-COUNTRY-ZONES';

export interface CountryZoneOption {
  id: string;
  /** «UTC−5». */
  utc: string;
  /** Головне місто поясу («Нью-Йорк»). */
  city: string;
  /** Північ поясу, мс epoch UTC. */
  midnightMs: number;
  /** «3 трансляції» / «лише відлік». */
  note?: string;
}

export interface CountryHeaderProps {
  country: Pick<Country, 'iso' | 'name' | 'flagCode' | 'gender'>;
  /** Північ головної події вибраного поясу. */
  midnightMs: number;
  /** Після півночі (+15 с): «північ була о …», без «Додати в графік». */
  after: boolean;
  /** Країни з кількома поясами; менше двох — без вибору поясу. */
  zones?: readonly CountryZoneOption[];
  selectedZoneId?: string;
  onZoneChange?(zoneId: string): void;
  /** Графік: стан і перемикач (без нього кнопок немає). */
  inSchedule?: boolean;
  onToggleSchedule?(): void;
  /** Часовий пояс глядача (тести, історії); типово — пояс браузера. */
  timeZone?: string;
  /** Після півночі головне святкування в «Рейтингу святкувань» — чіп «★ 4,5 · 6-те місце ›» (рішення власника 2026-11-07). */
  rating?: { score: number; place: number };
  className?: string;
}

function RatingChip({ rating }: { rating: { score: number; place: number } }) {
  const t = useTranslations('country.header');
  const score = rating.score.toFixed(1).replace('.', ',');
  const place = ukOrdinal(rating.place);
  return (
    <NextLink
      href="/rating/"
      data-rating-chip=""
      aria-label={t('ratingAria', { score, place })}
      className={cn('t2f-focus', h.ratingChip)}
    >
      <Icon name="star" size={14} className={h.ratingStar} />
      {t('ratingChip', { score, place })}
      <Icon name="chevron-right" size={12} />
    </NextLink>
  );
}

function ZonesList({
  zones,
  selected,
  onPick,
  timeZone,
}: {
  zones: readonly CountryZoneOption[];
  selected?: string;
  onPick(id: string): void;
  timeZone?: string;
}) {
  const t = useTranslations('country.header');
  return (
    <div role="radiogroup" aria-label={t('zones')} className={h.sheetList}>
      {zones.map((z) => {
        const on = z.id === selected;
        return (
          <button
            key={z.id}
            type="button"
            role="radio"
            aria-checked={on}
            data-zone-option={z.id}
            onClick={() => onPick(z.id)}
            className={cn('t2f-focus', h.sheetRow, on && h.sheetRowOn)}
          >
            <span aria-hidden="true" className={cn(h.radio, on && h.radioOn)}>
              {on ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
            </span>
            <span className={h.sheetText}>
              <span className={h.sheetCity}>
                {z.city} · {z.utc}
              </span>
              {z.note ? <span className={h.sheetNote}>{z.note}</span> : null}
            </span>
            <span className={h.sheetTime}>
              <b>{formatClock(z.midnightMs, timeZone ? { timeZone } : {})}</b>
              <span>{t('yourTime')}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CountryHeader({
  country,
  midnightMs,
  after,
  zones,
  selectedZoneId,
  onZoneChange,
  inSchedule = false,
  onToggleSchedule,
  timeZone,
  rating,
  className,
}: CountryHeaderProps) {
  const t = useTranslations('country.header');
  const tSched = useTranslations('liveMap.country');
  const overlay = useOverlay();

  const name = country.name.uk;
  const tz = timeZone ? { timeZone } : {};
  const time = formatClock(midnightMs, tz);
  const bold = (chunks: ReactNode) => <b className="font-semibold text-text">{chunks}</b>;
  const timeLine = after
    ? t.rich('midnightWas', { time, b: bold })
    : t.rich('midnightAt', { time, b: bold });
  const multi = !!zones && zones.length >= 2;
  const selected = multi ? zones.find((z) => z.id === selectedZoneId) : undefined;
  const schedule = !after && onToggleSchedule;
  const schedAria = inSchedule
    ? tSched('scheduleOnAria', { city: name })
    : tSched('scheduleAddAria', { city: name });

  const openZones = () => {
    if (!zones) return;
    overlay.open({
      id: ZONES_SHEET_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('zonesTitle', { country: name }),
      description: t('zonesSub', { count: zones.length }),
      content: (
        <div className="px-4 pb-4 pt-1">
          <ZonesList
            zones={zones}
            selected={selectedZoneId}
            timeZone={timeZone}
            onPick={(id) => {
              onZoneChange?.(id);
              overlay.close(ZONES_SHEET_ID);
            }}
          />
        </div>
      ),
    });
  };

  return (
    <div data-country-header="" data-after={after ? '' : undefined} className={className}>
      {/* Телефон: рядок над відео; складається, поки відкриті чат чи шторка. */}
      {/* `data-dock-above` — на обгортці, що складається: ChatDock стежить за її розміром і перемірює висоту чату й шторок. */}
      <div className={styles.phoneOnly}>
        <div data-dock-above="" className={h.rowWrap}>
          <div className={h.rowClip}>
            <div data-country-row="" className={h.row}>
              <Flag round code={country.flagCode} size="md" decorative />
              <div className={h.rowText}>
                <p className={h.rowName}>{name}</p>
                {multi && selected ? (
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={t('zonesPick', { zone: `${selected.city} · ${selected.utc}` })}
                    onClick={openZones}
                    className={cn('t2f-focus', h.zoneBtn)}
                  >
                    {selected.city} · {selected.utc} · {time}
                    <Icon name="chevron-down" size={14} />
                  </button>
                ) : (
                  <p className={h.rowTime}>{timeLine}</p>
                )}
              </div>
              {rating ? <RatingChip rating={rating} /> : null}
              {schedule ? (
                <IconButton
                  icon={inSchedule ? 'calendar-check' : 'calendar-add'}
                  variant="ring"
                  aria-pressed={inSchedule}
                  aria-label={schedAria}
                  data-schedule-header=""
                  onClick={onToggleSchedule}
                  className={cn('shrink-0', inSchedule && 'text-highlight')}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Десктоп. */}
      <div className={cn(styles.deskOnly, h.desk)}>
        <div className={h.deskRow}>
          <Flag round code={country.flagCode} size="xl" decorative />
          <p className={h.deskName}>{name}</p>
          {multi ? null : <p className={h.deskTime}>{timeLine}</p>}
          {rating ? <RatingChip rating={rating} /> : null}
          <span className="flex-1" />
          {schedule ? (
            <button
              type="button"
              aria-pressed={inSchedule}
              aria-label={schedAria}
              data-schedule-header=""
              onClick={onToggleSchedule}
              className={cn('t2f-focus', m.sched)}
            >
              <Icon
                name={inSchedule ? 'calendar-check' : 'calendar-add'}
                size={18}
                strokeWidth={inSchedule ? 2.2 : 2}
              />
              {inSchedule ? tSched('scheduleOn') : t('addToSchedule')}
            </button>
          ) : null}
        </div>
        {multi ? (
          <div role="radiogroup" aria-label={t('zones')} className={h.chips}>
            {zones.map((z) => {
              const on = z.id === selectedZoneId;
              return (
                <button
                  key={z.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-zone-option={z.id}
                  onClick={() => onZoneChange?.(z.id)}
                  className={cn('t2f-focus', h.chip, on && h.chipOn)}
                >
                  {z.utc} · {z.city}
                  <span className={h.chipTime}>{formatClock(z.midnightMs, tz)}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
