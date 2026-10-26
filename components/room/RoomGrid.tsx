'use client';

/**
 * C21 RoomGrid: «Кімната перегляду» (S-ROOM). Презентаційна сітка вікон: плеєри рендерить батько (`renderMedia`).
 * - `RoomHeader`: «← Країна», підсумок вікон, відлік, «+ Додати трансляцію» над сіткою;
 * - `RoomWindow`: позначена область; рядок назви (h2) — статус, назва, «У вашому графіку», «Звук тут / сюди», × «Прибрати»;
 * - `EmptyCell`: вільна клітинка при трьох вікнах на десктопі; `PickBanner` / `PhoneLimitNotice`: кімната повна;
 * - `ResumeCard`: збережене вікно, що чекає кліку (Facade + підпис).
 * Поверх відео нічого немає. Десктоп до 4 вікон (2×2), телефон до 2 (стовпчик).
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useId, type MouseEvent, type ReactNode } from 'react';
import { Facade } from '@/components/player/Facade';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { StatusMessage } from '@/components/primitives/StatusMessage';

export type RoomLayout = 'desktop' | 'phone';

export interface RoomWindowView {
  slot: number;
  /** «Париж · Ейфелева вежа» */
  title: string;
  /** Коротке місто для повідомлень, «Париж» */
  city: string;
  status: 'live' | 'expected' | 'possible' | 'recording';
  hasSound: boolean;
  /** Позначка «У вашому графіку». */
  inSchedule?: boolean;
  /** Маленька позначка штампа. */
  stamped?: boolean;
}

export interface RoomGridProps {
  layout: RoomLayout;
  /** «Франція» для посилання «← Франція». */
  countryName: string;
  countryHref: string;
  onBack?(e: MouseEvent<HTMLAnchorElement>): void;
  windows: readonly RoomWindowView[];
  /** 4 на десктопі / 2 на телефоні. */
  limit: number;
  /** Кімната повна, ця трансляція чекає місця. */
  pickTarget?: { title: string } | null;
  /** Відлік «до півночі 00:02:00» (праворуч у шапці, десктоп). */
  countdown?: ReactNode;
  /** Відео вікна; плеєр рендерить батько. */
  renderMedia(slot: number): ReactNode;
  onAdd(): void;
  /** Замінює типову кнопку «+ Додати трансляцію» (батько обгортає її в тригер Popover). */
  addControl?: ReactNode;
  onRemove(slot: number): void;
  onSound(slot: number): void;
  onReplace(slot: number): void;
  onCancelPick(): void;
  /** Під сіткою (десктоп): «Звук у вікні «Париж»». */
  soundStatus?: string;
  className?: string;
}

export interface RoomHeaderProps {
  layout: RoomLayout;
  countryName: string;
  countryHref: string;
  onBack?(e: MouseEvent<HTMLAnchorElement>): void;
  count: number;
  limit: number;
  countdown?: ReactNode;
  onAdd(): void;
  addControl?: ReactNode;
}

export function RoomHeader({ layout, countryName, countryHref, onBack, count, limit, countdown, onAdd, addControl }: RoomHeaderProps) {
  const t = useTranslations('room.header');
  const phone = layout === 'phone';
  return (
    <header className="flex flex-col gap-3">
      <NextLink
        href={countryHref}
        onClick={onBack}
        aria-label={t('backLabel', { country: countryName })}
        className="t2f-focus inline-flex min-h-touch-min w-fit items-center rounded-md text-body-strong text-text-secondary hover:text-text"
      >
        {t('back', { country: countryName })}
      </NextLink>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {phone ? (
          <h1 className="text-headline-sm text-text">{t('phoneLine', { count })}</h1>
        ) : (
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-headline-sm text-text">{t('title')}</h1>
            <p className="text-caption text-text-secondary">{count > 1 ? t('subline', { count, limit }) : t('sublineOne', { count, limit })}</p>
          </div>
        )}
        {!phone && countdown ? <div className="shrink-0 text-body-strong tabular-nums text-text">{countdown}</div> : null}
      </div>
      <div>
        {addControl ?? (
          <Button variant="tonal" iconLeft="plus" onClick={onAdd}>
            {t('add')}
          </Button>
        )}
      </div>
    </header>
  );
}

function StatusLabel({ status }: { status: RoomWindowView['status'] }) {
  const t = useTranslations('room.status');
  if (status === 'recording') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-label-badge text-text-muted">
        <Icon name="play" size={16} />
        {t('recording')}
      </span>
    );
  }
  return (
    <Badge variant="stream-status" status={status}>
      {t(status)}
    </Badge>
  );
}

export interface RoomWindowProps {
  view: RoomWindowView;
  id: string;
  /** Єдине вікно: звук не перемикається, × неактивний. */
  only: boolean;
  picking: boolean;
  media: ReactNode;
  onRemove(slot: number): void;
  onSound(slot: number): void;
  onReplace(slot: number): void;
}

export function RoomWindow({ view, id, only, picking, media, onRemove, onSound, onReplace }: RoomWindowProps) {
  const t = useTranslations('room.window');
  const headingId = `${id}-h`;
  const reasonId = `${id}-reason`;
  const last = only && !picking;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-room-window={view.slot}
      data-sound={view.hasSound ? '' : undefined}
      className={cn('flex min-w-0 flex-col gap-2 rounded-md border bg-surface p-2', view.hasSound && !only ? 'border-text' : 'border-border')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={headingId} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-body-strong text-text">
          <StatusLabel status={view.status} />
          <span className="min-w-0">{view.title}</span>
          {view.stamped ? (
            <span className="inline-flex items-center text-text-secondary">
              <Icon name="star" size={16} />
              <span className="sr-only">{t('stamped')}</span>
            </span>
          ) : null}
          {view.inSchedule ? <Badge variant="in-schedule" /> : null}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {picking ? (
            <Button variant="tonal" compact aria-label={t('replaceLabel', { title: view.title })} onClick={() => onReplace(view.slot)}>
              {t('replace')}
            </Button>
          ) : (
            <>
              {only ? null : view.hasSound ? (
                <Button
                  variant="tonal"
                  compact
                  iconLeft="speaker"
                  aria-pressed="true"
                  aria-label={t('soundHereLabel', { title: view.title })}
                  className="border-text"
                >
                  {t('soundHere')}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  compact
                  iconLeft="speaker-off"
                  aria-pressed="false"
                  aria-label={t('soundToLabel', { title: view.title })}
                  onClick={() => onSound(view.slot)}
                >
                  {t('soundTo')}
                </Button>
              )}
              <IconButton
                icon="close"
                variant="plain"
                compact
                iconSize={18}
                aria-label={t('remove', { title: view.title })}
                aria-disabled={last ? 'true' : undefined}
                aria-describedby={last ? reasonId : undefined}
                title={last ? t('lastReason') : undefined}
                className={last ? 'cursor-not-allowed text-text-muted' : undefined}
                onClick={last ? undefined : () => onRemove(view.slot)}
              />
              {last ? (
                <span id={reasonId} className="sr-only">
                  {t('lastReason')}
                </span>
              ) : null}
            </>
          )}
        </div>
      </div>
      <div className="min-w-0">{media}</div>
    </section>
  );
}

export function EmptyCell({ onAdd }: { onAdd(): void }) {
  const t = useTranslations('room.empty');
  return (
    <div
      data-empty-cell=""
      className="flex min-h-player-min-height min-w-0 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border-strong bg-surface p-6 text-center"
    >
      <p className="text-body text-text-secondary">{t('text')}</p>
      <Button variant="tonal" iconLeft="plus" onClick={onAdd}>
        {t('add')}
      </Button>
    </div>
  );
}

export function PickBanner({ title, onCancel }: { title: string; onCancel(): void }) {
  const t = useTranslations('room.pick');
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-strong bg-surface-raised px-4 py-2 text-body text-text"
    >
      <Icon name="info" size={20} className="text-text-secondary" />
      <span className="min-w-0 flex-1">
        <span className="text-body-strong">{t('banner', { title })}</span> <span className="text-text-secondary">{t('hint')}</span>
      </span>
      <Button variant="secondary" compact onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  );
}

export function PhoneLimitNotice({ title, onCancel }: { title: string; onCancel(): void }) {
  const t = useTranslations('room.phoneLimit');
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-raised p-4">
      <p className="text-body-strong text-text">{t('title')}</p>
      <p className="text-body text-text">{t('adding', { title })}</p>
      <p className="text-caption text-text-secondary">{t('hint')}</p>
      <div>
        <Button variant="secondary" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

function RoomSkipLinks({ nextHref }: { nextHref?: string }) {
  const t = useTranslations('room.skip');
  const cls =
    't2f-focus fixed left-2 top-2 z-50 -translate-y-24 rounded-md bg-surface-raised px-4 py-3 text-label-button text-text focus:translate-y-0';
  return (
    <nav aria-label={t('label')}>
      <ul className="m-0 list-none p-0">
        {nextHref ? (
          <li>
            <a href={nextHref} className={cls}>
              {t('nextWindow')}
            </a>
          </li>
        ) : null}
        <li>
          <a href="#chat" className={cls}>
            {t('chat')}
          </a>
        </li>
      </ul>
    </nav>
  );
}

/** C21. Сітка кімнати перегляду. */
export function RoomGrid({
  layout,
  countryName,
  countryHref,
  onBack,
  windows,
  limit,
  pickTarget = null,
  countdown,
  renderMedia,
  onAdd,
  addControl,
  onRemove,
  onSound,
  onReplace,
  onCancelPick,
  soundStatus,
  className,
}: RoomGridProps) {
  const base = useId();
  const phone = layout === 'phone';
  const count = windows.length;
  const only = count <= 1;
  const showEmpty = !phone && count === 3 && !pickTarget;
  const picking = !phone && Boolean(pickTarget);
  const idOf = (slot: number) => `${base}-w${slot}`;
  const second = windows[1];
  const nextHref = !phone && second ? `#${idOf(second.slot)}` : undefined;

  return (
    <div data-room="" className={cn('flex flex-col gap-4', className)}>
      {!phone ? <RoomSkipLinks nextHref={nextHref} /> : null}
      <RoomHeader
        layout={layout}
        countryName={countryName}
        countryHref={countryHref}
        onBack={onBack}
        count={count}
        limit={limit}
        countdown={countdown}
        onAdd={onAdd}
        addControl={addControl}
      />
      {picking && pickTarget ? <PickBanner title={pickTarget.title} onCancel={onCancelPick} /> : null}
      <div data-room-grid="" data-room-layout={count} className={cn('grid gap-4', phone || count === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {windows.map((w) => (
          <RoomWindow
            key={w.slot}
            view={w}
            id={idOf(w.slot)}
            only={only}
            picking={picking}
            media={renderMedia(w.slot)}
            onRemove={onRemove}
            onSound={onSound}
            onReplace={onReplace}
          />
        ))}
        {showEmpty ? <EmptyCell onAdd={onAdd} /> : null}
      </div>
      {phone && pickTarget ? <PhoneLimitNotice title={pickTarget.title} onCancel={onCancelPick} /> : null}
      {!phone && soundStatus ? <StatusMessage>{soundStatus}</StatusMessage> : null}
    </div>
  );
}

export interface ResumeCardProps {
  title: string;
  videoId?: string;
  onActivate(): void;
  className?: string;
}

/** Збережене вікно: кадр 16:9 як у плеєра, «Натисни, щоб увімкнути». Само нічого не грає. */
export function ResumeCard({ title, videoId, onActivate, className }: ResumeCardProps) {
  const t = useTranslations('room.resume');
  return (
    <div data-resume-card="" className={cn('flex flex-col gap-2', className)}>
      {videoId ? (
        <Facade videoId={videoId} title={title} onActivate={onActivate} />
      ) : (
        <button
          type="button"
          onClick={onActivate}
          aria-label={t('label', { title })}
          className="t2f-focus relative flex aspect-video w-full min-h-player-min-height min-w-player-min-height items-center justify-center overflow-hidden bg-surface-raised"
        >
          <span className="inline-flex size-16 items-center justify-center rounded-full bg-scrim text-text">
            <Icon name="play" size={22} />
          </span>
        </button>
      )}
      <p className="text-caption text-text-secondary">{t('activate')}</p>
    </div>
  );
}
