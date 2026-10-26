'use client';

/**
 * S-ROOM: вибір трансляції для кімнати перегляду («+ Додати трансляцію»).
 * - десктоп: Popover під кнопкою; телефон: Sheet (кнопку-тригер малює батьківський компонент);
 * - розділи: «<Країна>» (поточний пояс) і «Інші країни о <час>» (та сама північ);
 * - рядок — одна кнопка (без вкладених кнопок): дотик додає трансляцію й закриває панель;
 *   джерела, що вже в кімнаті, показують «У кімнаті» без кнопки.
 * Батьківський компонент сам вирішує, що робити з `onPick` (додати чи відкрити вікно заміни).
 */
import { useTranslations } from 'next-intl';
import { cloneElement, useId, type MouseEvent, type ReactElement } from 'react';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { Sheet } from '@/components/primitives/Sheet';
import { formatClock } from '@/lib/i18n/time';
import type { StreamRowData } from '@/lib/live/countryData';

export interface AddStreamPanelProps {
  layout: 'desktop' | 'phone';
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Десктоп: кнопка-тригер (PopoverTrigger asChild). Телефон: рендериться як є з onClick → onOpenChange(true). */
  trigger: React.ReactElement;
  countryName: string;
  countryStreams: readonly StreamRowData[];
  zoneStreams: readonly StreamRowData[];
  midnightMs: number;
  /** «північ за 20 хв» / «північ минула». */
  zoneNote?: string;
  /** Джерела, що вже в кімнаті. */
  inRoomIds: readonly string[];
  /** Кімната повна: підпис про вікно для заміни. */
  full?: boolean;
  onPick(row: StreamRowData): void;
  timeZone?: string;
}

const KIND_KEY = { main: 'main', webcam: 'webcam', tv: 'tv' } as const;

interface RowProps {
  row: StreamRowData;
  inRoom: boolean;
  timeZone?: string;
  onPick(row: StreamRowData): void;
}

function AddRow({ row, inRoom, timeZone, onPick }: RowProps) {
  const t = useTranslations('room.add');
  const ts = useTranslations('country.streams');
  const tType = useTranslations('liveCards.eventCard.type');
  const second = ts('rowCountry', { country: row.countryName, kind: tType(KIND_KEY[row.kind]) });
  const time = formatClock(row.midnightMs, timeZone ? { timeZone } : {});
  const past = row.status === 'recording';

  const body = (
    <>
      <Flag code={row.flagCode} size="sm" decorative />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body-strong text-text">{row.title}</span>
        <span className="text-caption text-text-secondary">{second}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {inRoom ? (
          <span className="text-label-badge text-text-secondary">{t('inRoom')}</span>
        ) : row.status === 'live' ? (
          <Badge variant="stream-status" status="live">
            {ts('status.live')}
          </Badge>
        ) : (
          <span className={cn('inline-flex items-center gap-1 text-label-badge', past ? 'text-text-muted' : 'text-text-secondary')}>
            <Icon name={past ? 'play' : row.status === 'possible' ? 'broadcast-dashed' : 'broadcast'} size={16} />
            {ts(`status.${row.status}`)}
          </span>
        )}
        <time dateTime={new Date(row.midnightMs).toISOString()} className="text-body-strong tabular-nums text-text">
          {time}
        </time>
      </span>
    </>
  );

  if (inRoom) {
    return (
      <li data-add-row={row.id} data-in-room="" className="list-none">
        <div role="group" aria-disabled="true" aria-label={t('inRoomLabel', { title: row.title })} className="flex min-h-touch-min items-center gap-3 rounded-md px-3 py-1.5 opacity-70">{body}</div>
      </li>
    );
  }
  return (
    <li data-add-row={row.id} className="list-none">
      <button
        type="button"
        aria-label={t('pick', { title: row.title })}
        onClick={() => onPick(row)}
        className="t2f-focus t2f-transition flex min-h-touch-min w-full items-center gap-3 rounded-md px-3 py-1.5 text-start hover:bg-surface-raised"
      >
        {body}
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border-strong text-text">
          <Icon name="plus" size={16} />
        </span>
      </button>
    </li>
  );
}

/** Вміст списку: розділи «<Країна>» і «Інші країни о <час>». */
export function AddStreamList({
  countryName,
  countryStreams,
  zoneStreams,
  midnightMs,
  inRoomIds,
  full = false,
  onPick,
  timeZone,
}: Omit<AddStreamPanelProps, 'layout' | 'open' | 'onOpenChange' | 'trigger'>) {
  const t = useTranslations('room.add');
  const countryId = useId();
  const zoneId = useId();
  const time = formatClock(midnightMs, timeZone ? { timeZone } : {});
  const empty = countryStreams.length === 0 && zoneStreams.length === 0;

  const renderRows = (rows: readonly StreamRowData[]) => (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <AddRow key={row.id} row={row} inRoom={inRoomIds.includes(row.id)} timeZone={timeZone} onPick={onPick} />
      ))}
    </ul>
  );

  return (
    <div data-add-stream-panel="" className="flex flex-col gap-4">
      {full ? <p className="m-0 text-caption text-text-secondary">{t('full')}</p> : null}
      {empty ? <p className="m-0 text-body text-text-secondary">{t('empty')}</p> : null}
      {countryStreams.length > 0 ? (
        <section aria-labelledby={countryId} className="flex flex-col gap-2">
          <h3 id={countryId} className="m-0 text-body-strong text-text">
            {countryName}
          </h3>
          {renderRows(countryStreams)}
        </section>
      ) : null}
      {zoneStreams.length > 0 ? (
        <section aria-labelledby={zoneId} className="flex flex-col gap-2">
          <h3 id={zoneId} className="m-0 text-body-strong text-text">
            {t('others', { time })}
          </h3>
          {renderRows(zoneStreams)}
        </section>
      ) : null}
    </div>
  );
}

/** «+ Додати трансляцію»: панель на десктопі, аркуш на телефоні. */
export function AddStreamPanel(p: AddStreamPanelProps) {
  const { layout, open, onOpenChange, trigger, zoneNote, midnightMs, timeZone, onPick, ...listProps } = p;
  const t = useTranslations('room.add');
  const time = formatClock(midnightMs, timeZone ? { timeZone } : {});
  const sub = zoneNote ? t('sub', { time, zoneNote }) : t('subNoNote', { time });

  const pick = (row: StreamRowData) => {
    onPick(row);
    onOpenChange(false);
  };
  const list = <AddStreamList {...listProps} midnightMs={midnightMs} timeZone={timeZone} onPick={pick} />;

  if (layout === 'phone') {
    const el = trigger as ReactElement<{ onClick?: (e: MouseEvent<HTMLElement>) => void }>;
    const orig = el.props.onClick;
    return (
      <>
        {cloneElement(el, {
          onClick: (e: MouseEvent<HTMLElement>) => {
            orig?.(e);
            onOpenChange(true);
          },
        })}
        <Sheet open={open} onOpenChange={onOpenChange} title={t('title')} description={sub}>
          {list}
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="flex max-h-96 w-96 flex-col gap-3 p-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-headline-sm text-text">{t('title')}</h2>
          <p className="m-0 text-caption text-text-muted">{sub}</p>
        </div>
        {list}
      </PopoverContent>
    </Popover>
  );
}
