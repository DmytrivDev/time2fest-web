'use client';

/**
 * O-STREAM-PICKER «Обрати трансляцію» за дошкою `Desk-ActionRow` (рішення власника 2026-11-01): кнопка під підписом
 * плеєра більше не веде на сторінку країни (туди веде назва над нею), а відкриває на місці чату (телефон — шторкою)
 * трансляції цієї півночі, що йдуть зараз: спершу країна поточної трансляції, нижче — решта поясу. Кожна — у рамці,
 * велика мініатюра з кнопкою «▶» (поточна — «Зараз грає» по центру мініатюри), назва — на всю ширину, нижче круглий
 * прапор з країною (один рядок) і «Наживо · Вебкамера».
 * Натиск перемикає відео тут же (`setChain` з `preferredSourceId`); на телефоні шторка після вибору закривається.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { streamRows, type StreamRowData } from '@/lib/live/countryData';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useNow } from '@/lib/time/TimeProvider';
import s from './streamPicker.module.css';

export const STREAM_PICKER_ID = 'O-STREAM-PICKER';

const KIND_KEY = { main: 'main', webcam: 'webcam', tv: 'tv' } as const;

/**
 * Трансляції, що йдуть зараз, у поясі події (та сама північ), за популярністю подій і порядком джерел. Порядок сталий:
 * вибір іншої трансляції лише переносить «Зараз грає», рядки місцями не міняються (правка власника 2026-11-01).
 */
export function liveRowsForMidnight(midnightMs: Ms, now: Ms): StreamRowData[] {
  const data = getData();
  const events = data.events
    .filter((e) => e.midnightMs === midnightMs)
    .sort((a, b) => b.popularity - a.popularity || (a.id < b.id ? -1 : 1));
  return streamRows(data, events, now).filter((r) => r.status === 'live');
}

function thumbOf(row: StreamRowData): string | undefined {
  const src = getData().chainsByEventId.get(row.eventId)?.sources.find((x) => x.id === row.id);
  return src?.platform === 'youtube' && src.videoId ? `https://i.ytimg.com/vi/${src.videoId}/mqdefault.jpg` : undefined;
}

export interface StreamPickerProps {
  midnightMs: Ms;
  /** Країна поточної трансляції — окремою групою згори. */
  countryIso?: string;
  /** Після вибору (телефон закриває шторку). */
  onPicked?: () => void;
  /**
   * Сторінка країни (рішення 2026-11-05): готові рядки — трансляції країни й поясу в будь-якому стані (очікується, запис),
   * і вибір через сторінку (`onPick`), бо пульт сам знає, яку подію показує.
   */
  rows?: readonly StreamRowData[];
  onPick?: (row: StreamRowData) => void;
}

export function StreamPicker({ midnightMs, countryIso, onPicked, rows: givenRows, onPick }: StreamPickerProps) {
  const t = useTranslations('player.picker');
  const tType = useTranslations('liveCards.eventCard.type');
  const tStatus = useTranslations('country.streams.status');
  const now = useNow({ granularity: 'minute' });
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const currentId = player?.selection?.kind === 'source' ? player.selection.source.id : null;
  const liveRows = useMemo(() => (givenRows ? [] : liveRowsForMidnight(midnightMs, now)), [givenRows, midnightMs, now]);
  const rows = givenRows ?? liveRows;
  const home = countryIso ? rows.filter((r) => r.countryIso === countryIso) : [];
  const rest = countryIso ? rows.filter((r) => r.countryIso !== countryIso) : rows;

  const pick = (row: StreamRowData) => {
    if (onPick) onPick(row);
    else {
      const sources = getData().chainsByEventId.get(row.eventId)?.sources ?? [];
      actions?.setChain({ eventId: row.eventId, sources, preferredSourceId: row.id });
    }
    onPicked?.();
  };

  const list = (items: readonly StreamRowData[], label: string) => (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={label}>
      {items.map((row) => {
        const on = row.id === currentId;
        const thumb = thumbOf(row);
        return (
          <li key={row.id}>
            <button
              type="button"
              aria-current={on ? 'true' : undefined}
              data-source={row.id}
              onClick={() => pick(row)}
              className={cn('t2f-focus t2f-transition', s.row, on && s.rowOn)}
            >
              <span aria-hidden="true" className={s.thumb}>
                {thumb ? (
                  // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" loading="lazy" decoding="async" />
                ) : null}
                {on ? (
                  <span className={s.playingTag}>{t('playing')}</span>
                ) : (
                  <span className={s.playBtn}>
                    <Icon name="play" size={16} />
                  </span>
                )}
              </span>
              <span className={s.text}>
                {/* Назва — на всю ширину (до двох рядків); прапор — круглий, у рядку з країною (правка власника 2026-11-01). */}
                <span className={s.titleText}>{row.title}</span>
                <span className={s.sub}>
                  <Flag round code={row.flagCode} size="xs" decorative />
                  <span className={s.subText}>{row.countryName}</span>
                </span>
                <span className={s.live}>
                  {row.status === 'live' ? (
                    <>
                      <Icon name="broadcast-live" size={14} className="text-primary" />
                      {t('liveKind', { kind: tType(KIND_KEY[row.kind]) })}
                    </>
                  ) : (
                    <>
                      <Icon name={row.status === 'recording' ? 'play' : 'broadcast'} size={14} />
                      {`${tStatus(row.status)} · ${tType(KIND_KEY[row.kind])}`}
                    </>
                  )}
                  {on ? <span className="sr-only">. {t('playing')}</span> : null}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const countryName = home[0]?.countryName;
  return (
    <section data-window={STREAM_PICKER_ID} className="flex flex-col gap-3 px-4 pb-4 pt-1">
      <p className={s.lead}>{givenRows ? t('eyebrowCountry') : t('eyebrow')}</p>
      {rows.length === 0 ? <p className={s.empty}>{t('empty')}</p> : null}
      {home.length ? (
        <div className="flex flex-col gap-2" data-group="country">
          <p className={s.eyebrow}>{countryName}</p>
          {list(home, countryName ?? '')}
        </div>
      ) : null}
      {rest.length ? (
        <div className={cn('flex flex-col gap-2', home.length > 0 && s.groupGap)} data-group="zone">
          {home.length ? <p className={s.eyebrow}>{t('restOfZone')}</p> : null}
          {list(rest, t('restOfZone'))}
        </div>
      ) : null}
    </section>
  );
}
