'use client';

/**
 * O-STREAM-PICKER «Обрати трансляцію» за дошкою `Desk-ActionRow` (рішення власника 2026-11-01): кнопка під підписом
 * плеєра більше не веде на сторінку країни (туди веде назва над нею), а відкриває на місці чату (телефон — шторкою)
 * список трансляцій цієї півночі, що йдуть зараз: місто, інші камери, сусідні країни поясу. Натиск перемикає відео тут
 * же (`setChain` з `preferredSourceId`), сторінка й чат лишаються; на телефоні шторка після вибору закривається.
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

/** Трансляції, що йдуть зараз, у поясі події (та сама північ); поточна — першою, далі за популярністю подій. */
export function liveRowsForMidnight(midnightMs: Ms, now: Ms, currentId?: string | null): StreamRowData[] {
  const data = getData();
  const events = data.events
    .filter((e) => e.midnightMs === midnightMs)
    .sort((a, b) => b.popularity - a.popularity || (a.id < b.id ? -1 : 1));
  const rows = streamRows(data, events, now).filter((r) => r.status === 'live');
  return currentId ? [...rows.filter((r) => r.id === currentId), ...rows.filter((r) => r.id !== currentId)] : rows;
}

function thumbOf(row: StreamRowData): string | undefined {
  const src = getData().chainsByEventId.get(row.eventId)?.sources.find((x) => x.id === row.id);
  return src?.platform === 'youtube' && src.videoId ? `https://i.ytimg.com/vi/${src.videoId}/mqdefault.jpg` : undefined;
}

export interface StreamPickerProps {
  midnightMs: Ms;
  /** Після вибору (телефон закриває шторку). */
  onPicked?: () => void;
}

export function StreamPicker({ midnightMs, onPicked }: StreamPickerProps) {
  const t = useTranslations('player.picker');
  const tType = useTranslations('liveCards.eventCard.type');
  const now = useNow({ granularity: 'minute' });
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const currentId = player?.selection?.kind === 'source' ? player.selection.source.id : null;
  const rows = useMemo(() => liveRowsForMidnight(midnightMs, now, currentId), [midnightMs, now, currentId]);

  const pick = (row: StreamRowData) => {
    const sources = getData().chainsByEventId.get(row.eventId)?.sources ?? [];
    actions?.setChain({ eventId: row.eventId, sources, preferredSourceId: row.id });
    onPicked?.();
  };

  return (
    <section data-window={STREAM_PICKER_ID} className="flex flex-col gap-2 px-4 pb-4 pt-3">
      <p className={s.eyebrow}>{t('eyebrow')}</p>
      {rows.length === 0 ? <p className={s.empty}>{t('empty')}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('listLabel')}>
        {rows.map((row) => {
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
                </span>
                <span className={s.text}>
                  <span className={s.title}>
                    <Flag code={row.flagCode} size="card" decorative />
                    <span className={s.titleText}>{row.title}</span>
                  </span>
                  <span className={s.sub}>{t('rowSub', { country: row.countryName, kind: tType(KIND_KEY[row.kind]) })}</span>
                  <span className={s.live}>
                    <Icon name="broadcast-live" size={14} className="text-primary" />
                    {t('live')}
                  </span>
                </span>
                {on ? <span className={s.playing}>{t('playing')}</span> : <Icon name="play" size={18} className="shrink-0 text-text-secondary" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
