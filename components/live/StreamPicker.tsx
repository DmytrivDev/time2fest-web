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
import { useContext, useId, useMemo, useState } from 'react';
import { useAddToRoom } from '@/components/room/useRoomViewport';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { streamRows, type StreamRowData } from '@/lib/live/countryData';
import { cityOf } from '@/lib/live/cityOf';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useNow } from '@/lib/time/TimeProvider';
import { thumbOf } from '@/lib/live/thumb';
import { canAddToRoom, RoomPageContext, useRoomToggle } from '@/components/room/useRoomToggle';
import { RoomAddConfirm } from './RoomAddConfirm';
import { CalendarButton, scheduleClosed } from './CalendarButton';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import { useGuestStore } from '@/stores/guest';
import { usePhone } from '@/lib/hooks/useMedia';
import nn from './nowNext.module.css';
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

export { thumbOf };

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
  /** «+» — у кімнату перегляду (правка власника 2026-11-05); без нього — поточна трансляція плеєра + обрана. */
  onAddToRoom?: (row: StreamRowData) => void;
  /** Календарик у рядку — «Додати в графік» (запис «країна + пояс»; без пасу — вікно пасу). */
  onToggleSchedule?: (eventId: string) => void;
}

export function StreamPicker({
  midnightMs,
  countryIso,
  onPicked,
  rows: givenRows,
  onPick,
  onAddToRoom,
  onToggleSchedule,
}: StreamPickerProps) {
  const t = useTranslations('player.picker');
  const tType = useTranslations('liveCards.eventCard.type');
  const tStatus = useTranslations('country.streams.status');
  const now = useNow({ granularity: 'minute' });
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const currentId = player?.selection?.kind === 'source' ? player.selection.source.id : null;
  const liveRows = useMemo(
    () => (givenRows ? [] : liveRowsForMidnight(midnightMs, now)),
    [givenRows, midnightMs, now],
  );
  const rows = givenRows ?? liveRows;
  const home = countryIso ? rows.filter((r) => r.countryIso === countryIso) : [];
  const rest = countryIso ? rows.filter((r) => r.countryIso !== countryIso) : rows;

  const tStreams = useTranslations('country.streams');
  const uid = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const phone = usePhone();
  const room = useRoomToggle();
  // Сторінка кімнати: «+» додає одразу (і на телефоні), повна кімната відкриває «Що замінити?».
  const roomPage = useContext(RoomPageContext);
  const confirm = phone && !roomPage;
  const addRoom = useAddToRoom();
  const currentRow = currentId ? (rows.find((r) => r.id === currentId) ?? null) : null;
  const schedule = useGuestStore((g) => g.schedule);
  const nowSec = useNow();
  const inSched = (eventId: string) =>
    countryZoneEvents(eventId).some((id) => schedule.includes(id));
  const add = (row: StreamRowData) => {
    if (onAddToRoom) onAddToRoom(row);
    else
      addRoom(
        { sourceId: row.id, eventId: row.eventId },
        currentId && player?.eventId ? { sourceId: currentId, eventId: player.eventId } : null,
      );
    onPicked?.();
  };

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
          <li
            key={row.id}
            className={cn(s.pickCard, on && s.pickCardOn, confirming === row.id && s.pickCardOpen)}
          >
            {/* Варіант A (дошка `Desk-Picker-Row`, рішення власника 2026-11-05): мініатюра й назва на всю ширину; знизу —
                рядок статусу й кнопки «+» і календарик, вирівняні по центру. */}
            <button
              type="button"
              aria-current={on ? 'true' : undefined}
              data-source={row.id}
              onClick={() => pick(row)}
              className={cn('t2f-focus t2f-transition', s.pickMain)}
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
                  <Flag code={row.flagCode} size="xs" decorative />
                  <span className={s.subText}>{row.countryName}</span>
                </span>
              </span>
            </button>
            <div className={s.pickFoot}>
              <span className={s.live}>
                {row.status === 'live' ? (
                  <>
                    <Icon name="broadcast-live" size={16} className="text-primary" />
                    {t('liveKind', { kind: tType(KIND_KEY[row.kind]) })}
                  </>
                ) : (
                  <>
                    <Icon name={row.status === 'recording' ? 'play' : 'broadcast'} size={16} />
                    {`${tStatus(row.status)} · ${tType(KIND_KEY[row.kind])}`}
                  </>
                )}
                {on ? <span className="sr-only">. {t('playing')}</span> : null}
              </span>
              <span className={s.pickBtns}>
                {on || !canAddToRoom(row.status) ? null : (
                  // Той самий кружок, що й календарик. Телефон — підтвердження під рядком; десктоп — одразу в кімнату (✓).
                  <button
                    type="button"
                    aria-label={
                      !confirm && room.has(row.id)
                        ? tStreams('inRoom', { title: row.title })
                        : tStreams('add', { title: row.title })
                    }
                    aria-pressed={confirm ? undefined : room.has(row.id)}
                    aria-expanded={confirm ? confirming === row.id : undefined}
                    aria-controls={confirm && confirming === row.id ? `${uid}-${row.id}` : undefined}
                    disabled={!roomPage && !phone && !room.has(row.id) && room.full}
                    onClick={() =>
                      confirm
                        ? setConfirming(confirming === row.id ? null : row.id)
                        : (roomPage ?? room).toggle({ sourceId: row.id, eventId: row.eventId })
                    }
                    className={cn('t2f-focus t2f-press rounded-full', nn.cal, s.pickCal)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        nn.calCircle,
                        !confirm && room.has(row.id) && nn.plusOn,
                        confirm && confirming === row.id && nn.plusOpen,
                      )}
                    >
                      <Icon
                        name={!confirm && room.has(row.id) ? 'check' : 'plus'}
                        size={16}
                        strokeWidth={2.4}
                      />
                    </span>
                  </button>
                )}
                <CalendarButton
                  city={cityOf(row.title)}
                  inSchedule={inSched(row.eventId)}
                  closed={scheduleClosed(row.midnightMs, nowSec)}
                  onToggle={onToggleSchedule ? () => onToggleSchedule(row.eventId) : undefined}
                  className={s.pickCal}
                />
              </span>
            </div>
            {phone && confirming === row.id ? (
              <RoomAddConfirm
                id={`${uid}-${row.id}`}
                row={row}
                current={currentRow}
                onCancel={() => setConfirming(null)}
                onConfirm={() => {
                  setConfirming(null);
                  add(row);
                }}
                className={s.confirm}
              />
            ) : null}
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
