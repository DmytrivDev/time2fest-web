'use client';

/**
 * C2 StreamList: «Міста й трансляції · <Країна>» і «Трансляції в цьому поясі».
 * - `StreamRow`: дотик до рядка перемикає трансляцію; праворуч `ring` «+» (або «−» для поточної);
 * - `PlusMenu` (Popover, десктоп і планшет) / `PlusConfirm` (телефон, під рядком): «Додати…» / «Відкрити кімнату»
 *   викликають `onAddToRoom(row)` (сторінка додає в `stores/room` і відкриває кімнату); у кімнаті (`context="room"`) «+» додає одразу;
 * - `ZoneStreamsBlock`: згортання зберігається в `guest.zoneStreamsCollapsed`;
 * - `MoreStreamsSheet`: ВМІСТ аркуша телефона (відкриває сторінка через `useOverlay`).
 * Міста «Лише відлік» сюди не потрапляють (їх відсікає `streamRows`). Назви міст і країн — лише в називному.
 */
import { useTranslations } from 'next-intl';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { formatClock } from '@/lib/i18n/time';
import type { StreamRowData } from '@/lib/live/countryData';
import { useGuestStore } from '@/stores/guest';

export const MORE_STREAMS_ID = 'O-MORE-STREAMS';

const PHONE_QUERY = '(max-width: 767.98px)';

function subscribePhone(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getPhone = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY).matches : false);
function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, getPhone, () => false);
}

const KIND_KEY = { main: 'main', webcam: 'webcam', tv: 'tv' } as const;

/** «Париж · Ейфелева вежа» → «Париж». */
function cityOf(title: string): string {
  return title.split(' · ')[0] ?? title;
}

const GRID = 'm-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-2';

export interface StreamRowProps {
  row: StreamRowData;
  current: boolean;
  /** Друга лінія: «Німеччина · Головне святкування» (блок поясу, аркуш). */
  showCountry?: boolean;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
  timeZone?: string;
  /** Трансляція іншої країни: в меню «Перейти до цієї трансляції». */
  otherCountry?: boolean;
  /** Назва поточної трансляції для підтвердження на телефоні («Париж і Берлін»). */
  currentTitle?: string;
  /** У кімнаті «+» додає одразу, без меню й підтвердження. */
  context?: 'country' | 'room';
}

function PlusMenu({ row, otherCountry, onSelect, onAddToRoom }: Pick<StreamRowProps, 'row' | 'onSelect' | 'onAddToRoom' | 'otherCountry'>) {
  const t = useTranslations('country.streams');
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton icon="plus" variant="ring" compact iconSize={16} aria-label={t('add', { title: row.title })} aria-haspopup="menu" aria-expanded={open} />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="flex w-72 flex-col gap-1 p-2">
        <PopoverClose asChild>
          <Button variant="ghost" className="w-full justify-start text-text" onClick={() => onSelect(row)}>
            {otherCountry ? t('menu.goTo') : t('menu.replace')}
          </Button>
        </PopoverClose>
        <PopoverClose asChild>
          <Button
            variant="ghost"
            disabled={!onAddToRoom}
            className="h-auto w-full flex-col items-start justify-center gap-0 py-2 text-start text-text"
            onClick={() => onAddToRoom?.(row)}
          >
            {t('menu.addNew')}
            <span className="text-caption font-normal text-text-secondary">{t('menu.addHint')}</span>
          </Button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

function PlusConfirm({
  id,
  row,
  currentTitle,
  onCancel,
  onConfirm,
}: {
  id: string;
  row: StreamRowData;
  currentTitle?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const t = useTranslations('country.streams');
  const tc = useTranslations('common');
  return (
    <div id={id} role="group" aria-label={t('addLabel')} className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-body text-text-secondary">
        {currentTitle ? t('confirm.text', { first: cityOf(currentTitle), second: cityOf(row.title) }) : t('confirm.generic')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="tonal" onClick={onConfirm}>
          {t('confirm.open')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Рядок трансляції: прапор, назва, тип/країна, статус і час півночі; праворуч «+» / «−». */
export function StreamRow({
  row,
  current,
  showCountry = false,
  onSelect,
  onAddToRoom,
  timeZone,
  otherCountry = false,
  currentTitle,
  context = 'country',
}: StreamRowProps) {
  const t = useTranslations('country.streams');
  const tType = useTranslations('liveCards.eventCard.type');
  const phone = usePhone();
  const [confirming, setConfirming] = useState(false);
  const confirmId = useId();

  const kind = tType(KIND_KEY[row.kind]);
  const second = showCountry ? t('rowCountry', { country: row.countryName, kind }) : kind;
  const time = formatClock(row.midnightMs, timeZone ? { timeZone } : {});
  const past = row.status === 'recording';

  let plus: ReactNode;
  if (current) {
    plus = (
      <IconButton
        icon="minus"
        variant="ring"
        compact
        iconSize={16}
        aria-label={t('currentOnly', { title: row.title })}
        aria-disabled="true"
        className="cursor-not-allowed text-text-muted"
      />
    );
  } else if (context === 'room') {
    plus = (
      <IconButton icon="plus" variant="ring" compact iconSize={16} aria-label={t('add', { title: row.title })} onClick={() => onAddToRoom?.(row)} />
    );
  } else if (phone) {
    plus = (
      <IconButton
        icon="plus"
        variant="ring"
        compact
        iconSize={16}
        aria-label={t('add', { title: row.title })}
        aria-expanded={confirming}
        aria-controls={confirming ? confirmId : undefined}
        onClick={() => setConfirming((v) => !v)}
      />
    );
  } else {
    plus = <PlusMenu row={row} otherCountry={otherCountry} onSelect={onSelect} onAddToRoom={onAddToRoom} />;
  }

  return (
    <li
      data-stream-row={row.id}
      data-current={current ? '' : undefined}
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-surface py-1.5 ps-1 pe-2',
        current ? 'border-text bg-surface-raised' : 'border-transparent',
      )}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={current}
          onClick={() => onSelect(row)}
          className="t2f-focus t2f-transition flex min-h-touch-min min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-1.5 text-start hover:bg-surface-raised"
        >
          <Flag code={row.flagCode} size="sm" decorative />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body-strong text-text">{row.title}</span>
            <span className="text-caption text-text-secondary">{second}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {row.status === 'live' ? (
              <Badge variant="stream-status" status="live">
                {t('status.live')}
              </Badge>
            ) : (
              <span className={cn('inline-flex items-center gap-1 text-label-badge', past ? 'text-text-muted' : 'text-text-secondary')}>
                <Icon name={past ? 'play' : row.status === 'possible' ? 'broadcast-dashed' : 'broadcast'} size={16} />
                {t(`status.${row.status}`)}
              </span>
            )}
            <time dateTime={new Date(row.midnightMs).toISOString()} className="text-body-strong tabular-nums text-text">
              {time}
            </time>
          </span>
        </button>
        {plus}
      </div>
      {confirming && phone && !current ? (
        <div className="px-3 pb-2">
          <PlusConfirm
            id={confirmId}
            row={row}
            currentTitle={currentTitle}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              onAddToRoom?.(row);
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

export interface StreamListProps {
  /** «Міста й трансляції · Франція»; «Записи · Франція», коли всі рядки — записи. */
  countryName: string;
  streams: readonly StreamRowData[];
  currentStreamId: string | null;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
  context?: 'country' | 'room';
  timeZone?: string;
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

function currentTitleOf(streams: readonly StreamRowData[], id: string | null): string | undefined {
  return id ? streams.find((s) => s.id === id)?.title : undefined;
}

/** C2. Трансляції країни в поясі. */
export function StreamList({
  countryName,
  streams,
  currentStreamId,
  onSelect,
  onAddToRoom,
  context = 'country',
  timeZone,
  headingLevel = 'h2',
  className,
}: StreamListProps) {
  const t = useTranslations('country.streams');
  const headingId = useId();
  if (streams.length === 0) return null;
  const Heading = headingLevel;
  const allRecordings = streams.every((s) => s.status === 'recording');
  const currentTitle = currentTitleOf(streams, currentStreamId);

  return (
    <section data-stream-list="" aria-labelledby={headingId} className={cn('flex flex-col gap-2', className)}>
      <Heading id={headingId} className="text-headline-sm text-text">
        {allRecordings ? t('headingRecordings', { country: countryName }) : t('heading', { country: countryName })}
      </Heading>
      <ul className={GRID}>
        {streams.map((row) => (
          <StreamRow
            key={row.id}
            row={row}
            current={row.id === currentStreamId}
            onSelect={onSelect}
            onAddToRoom={onAddToRoom}
            timeZone={timeZone}
            currentTitle={currentTitle}
            context={context}
          />
        ))}
      </ul>
    </section>
  );
}

export interface ZoneStreamsBlockProps {
  streams: readonly StreamRowData[];
  currentStreamId: string | null;
  midnightMs: number;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
  timeZone?: string;
  /** У кімнаті «+» додає одразу (без меню). */
  context?: 'country' | 'room';
  /** Підказка під заголовком (кімната: «"+" додає трансляцію в кімнату · вільні 3 з 4»). */
  hint?: ReactNode;
  className?: string;
}

/** «Трансляції в цьому поясі»: інші країни з тією самою північчю. Згортання запам’ятовується. */
export function ZoneStreamsBlock({
  streams,
  currentStreamId,
  midnightMs,
  onSelect,
  onAddToRoom,
  timeZone,
  context = 'country',
  hint,
  className,
}: ZoneStreamsBlockProps) {
  const t = useTranslations('country.streams');
  const tNav = useTranslations('nav');
  const tc = useTranslations('common');
  const collapsed = useGuestStore((s) => s.zoneStreamsCollapsed);
  const setCollapsed = useGuestStore((s) => s.setZoneStreamsCollapsed);
  const listId = useId();
  const titleId = useId();
  if (streams.length === 0) return null;
  const time = formatClock(midnightMs, timeZone ? { timeZone } : {});
  const currentTitle = currentTitleOf(streams, currentStreamId);

  return (
    <section data-zone-streams="" aria-labelledby={titleId} className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 id={titleId} className="text-headline-sm text-text">
            {tNav('streamsInZone')}
          </h3>
          <span className="text-caption text-text-muted">{t('zoneSub', { time })}</span>
          {hint ? <span className="w-full text-caption text-text-secondary">{hint}</span> : null}
        </div>
        <Button
          variant="ghost"
          iconRight={collapsed ? 'chevron-down' : 'chevron-up'}
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? tc('expand') : tc('collapse')}
        </Button>
      </div>
      <ul id={listId} hidden={collapsed} aria-labelledby={titleId} className={GRID}>
        {streams.map((row) => (
          <StreamRow
            key={row.id}
            row={row}
            current={row.id === currentStreamId}
            showCountry
            otherCountry
            onSelect={onSelect}
            onAddToRoom={onAddToRoom}
            timeZone={timeZone}
            currentTitle={currentTitle}
            context={context}
          />
        ))}
      </ul>
    </section>
  );
}

export interface MoreStreamsSheetProps {
  countryName: string;
  countryStreams: readonly StreamRowData[];
  zoneStreams: readonly StreamRowData[];
  midnightMs: number;
  currentStreamId: string | null;
  onSelect(row: StreamRowData): void;
  onAddToRoom?(row: StreamRowData): void;
  timeZone?: string;
}

/** Вміст аркуша «Трансляції о 01:00» (телефон): розділи «<Країна>» і «Інші країни о 01:00». */
export function MoreStreamsSheet({
  countryName,
  countryStreams,
  zoneStreams,
  midnightMs,
  currentStreamId,
  onSelect,
  onAddToRoom,
  timeZone,
}: MoreStreamsSheetProps) {
  const t = useTranslations('country.streams');
  const countryId = useId();
  const zoneId = useId();
  const time = formatClock(midnightMs, timeZone ? { timeZone } : {});
  const currentTitle = currentTitleOf([...countryStreams, ...zoneStreams], currentStreamId);

  return (
    <div data-more-streams="" className="flex flex-col gap-4">
      {countryStreams.length > 0 ? (
        <section aria-labelledby={countryId} className="flex flex-col gap-2">
          <h3 id={countryId} className="text-body-strong text-text">
            {countryName}
          </h3>
          <ul className={GRID}>
            {countryStreams.map((row) => (
              <StreamRow
                key={row.id}
                row={row}
                current={row.id === currentStreamId}
                onSelect={onSelect}
                onAddToRoom={onAddToRoom}
                timeZone={timeZone}
                currentTitle={currentTitle}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {zoneStreams.length > 0 ? (
        <section aria-labelledby={zoneId} className="flex flex-col gap-2">
          <h3 id={zoneId} className="text-body-strong text-text">
            {t('sheet.others', { time })}
          </h3>
          <ul className={GRID}>
            {zoneStreams.map((row) => (
              <StreamRow
                key={row.id}
                row={row}
                current={row.id === currentStreamId}
                showCountry
                otherCountry
                onSelect={onSelect}
                onAddToRoom={onAddToRoom}
                timeZone={timeZone}
                currentTitle={currentTitle}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
