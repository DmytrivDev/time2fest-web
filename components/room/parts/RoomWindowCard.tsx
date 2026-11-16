'use client';

/**
 * Вікно кімнати перегляду (дошка `Desk-Room-New`, власник 2026-11-05): смуга над кадром — завжди один рядок:
 * іконка «наживо» (або «запис»), круглий прапор, назва (обрізається «…»), штамп (сірий — буде опівночі, жовтий — уже
 * в паспорті), календарик (у графіку), «Звук тут / Звук сюди», ×. Кадр — точно 16:9, плеєр рендерить батько.
 *
 * - Смуга — ручка перетягування (десктоп, від 2 вікон): курсор «рука» й світліше тло, без підказок (вони заходили б
 *   на відео). Під час перетягування над відео нічого не рухається: змінюються лише смуги й рамки (правила YouTube).
 * - `notice`: 6 с смуга показує, що сталося з вікном («Замінено: Дублін → Амстердам · Повернути»).
 * - `folded` (телефон, розгорнутий чат): кадр схований, плеєр на паузі, лишається смужка «на паузі · розгорнути».
 */
import { useTranslations } from 'next-intl';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import s from '@/components/room/room.module.css';

export interface RoomWindowCardView {
  slot: number;
  title: string;
  flagCode: string;
  status: 'live' | 'expected' | 'possible' | 'recording';
  /** Вікно, за яким закріплено звук (стан кімнати). */
  hasSound: boolean;
  /**
   * У вікні зі звуком справді чути (фактичний стан плеєра: mute / гучність). `false` — плашки «Звук тут» немає ніде,
   * у всіх вікнах «Звук сюди» (власник 2026-11-10: плашка має відповідати дійсності).
   */
  audible?: boolean;
  inSchedule: boolean;
  /** Штамп події: `todo` — опівночі тут буде штамп, `got` — уже в паспорті. */
  stamp: 'todo' | 'got';
  /** Трансляція завершилась: замість кадру — «Трансляція завершилась · Додати іншу». */
  endedCard?: ReactNode;
}

export interface RoomWindowCardProps {
  view: RoomWindowCardView;
  id: string;
  /** Позиція в сітці (CSS `order`): DOM не переставляємо, щоб плеєри не перезапускались. */
  order: number;
  /** Місце в сітці (ціль перетягування). */
  pos?: number;
  phone: boolean;
  /** Єдине вікно: без «Звук сюди», × неактивний. */
  only: boolean;
  media: ReactNode;
  drag?: 'src' | 'dst' | null;
  draggable?: boolean;
  notice?: { text: string; undo: string; onUndo(): void } | null;
  folded?: boolean;
  onUnfold?(): void;
  onBarPointerDown?(e: PointerEvent<HTMLDivElement>, slot: number): void;
  onRemove(slot: number): void;
  onSound(slot: number): void;
}

export function RoomWindowCard({
  view,
  id,
  order,
  pos,
  phone,
  only,
  media,
  drag = null,
  draggable = false,
  notice = null,
  folded = false,
  onUnfold,
  onBarPointerDown,
  onRemove,
  onSound,
}: RoomWindowCardProps) {
  const t = useTranslations('room.window');
  const headingId = `${id}-h`;
  const style: CSSProperties = { order };
  const soundHere = view.hasSound && view.audible !== false;

  const bar = (() => {
    if (drag === 'src') {
      return (
        <div className={cn(s.bar, s.barDragging)}>
          <Icon name="swap" size={18} className="text-highlight" />
          <h2 id={headingId} className={cn(s.title, s.titleYel)}>
            {t('moving', { title: view.title })}
          </h2>
        </div>
      );
    }
    if (drag === 'dst') {
      return (
        <div className={cn(s.bar, s.barTarget)}>
          <Icon name="swap" size={18} className="text-highlight" />
          <h2 id={headingId} className={cn(s.title, s.titleYel)}>
            {t('dropHere')}
          </h2>
        </div>
      );
    }
    if (notice) {
      return (
        <div className={cn(s.bar, phone && s.barPhone, s.barNotice)} role="status">
          <Icon name="swap" size={18} className="text-highlight" />
          <h2 id={headingId} className={s.title}>
            {notice.text}
          </h2>
          <button
            type="button"
            className={cn('t2f-focus', s.pill, s.pillOn)}
            style={{ cursor: 'pointer' }}
            onClick={notice.onUndo}
          >
            <Icon name="undo" size={16} />
            {notice.undo}
          </button>
          <span className={s.progress} aria-hidden="true" />
        </div>
      );
    }
    return (
      <div
        className={cn(s.bar, phone && s.barPhone, draggable && s.barDrag)}
        onPointerDown={
          draggable && onBarPointerDown ? (e) => onBarPointerDown(e, view.slot) : undefined
        }
      >
        {view.status === 'recording' ? (
          <span className={s.rec} title={t('rec')}>
            <Icon name="play" size={18} />
            <span className="sr-only">{t('rec')}</span>
          </span>
        ) : (
          <span className={s.live} title={t('live')}>
            <Icon name="broadcast-live" size={20} />
            <span className="sr-only">{t('live')}</span>
          </span>
        )}
        <Flag code={view.flagCode} size="xs" decorative />
        <h2 id={headingId} className={s.title} title={view.title}>
          {view.title}
        </h2>
        <span
          className={cn(s.mark, view.stamp === 'got' && s.markOn)}
          title={view.stamp === 'got' ? t('stampGot') : t('stampTodo')}
        >
          <Icon name="stamp" size={18} />
          <span className="sr-only">{view.stamp === 'got' ? t('stampGot') : t('stampTodo')}</span>
        </span>
        {view.inSchedule ? (
          <span className={cn(s.mark, s.markOn)} title={t('inSchedule')}>
            <Icon name="calendar-check" size={18} />
            <span className="sr-only">{t('inSchedule')}</span>
          </span>
        ) : null}
        {only ? null : soundHere ? (
          <button
            type="button"
            className={cn('t2f-focus', s.pill, s.pillOn, phone && s.pillIcon)}
            aria-pressed="true"
            aria-label={t('soundHereLabel', { title: view.title })}
          >
            <Icon name="speaker" size={16} />
            {phone ? null : t('soundHere')}
          </button>
        ) : (
          <button
            type="button"
            className={cn('t2f-focus', s.pill, phone && s.pillIcon)}
            aria-label={t('soundToLabel', { title: view.title })}
            aria-pressed="false"
            onClick={() => onSound(view.slot)}
          >
            <Icon name="speaker-off" size={16} />
            {phone ? null : t('soundTo')}
          </button>
        )}
        <button
          type="button"
          className={cn('t2f-focus', s.close, only && s.closeOff)}
          aria-label={t('remove', { title: view.title })}
          aria-disabled={only ? 'true' : undefined}
          title={only ? t('lastReason') : undefined}
          onClick={only ? undefined : () => onRemove(view.slot)}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    );
  })();

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-room-window={view.slot}
      data-room-pos={pos}
      data-sound={view.hasSound ? '' : undefined}
      data-audible={soundHere ? '' : undefined}
      data-folded={folded ? '' : undefined}
      style={style}
      className={cn(
        s.window,
        phone && s.windowPhone,
        drag === 'src' && s.windowDragSrc,
        drag === 'dst' && s.windowDragDst,
        notice && s.windowNotice,
      )}
    >
      {folded ? (
        <div className={s.folded}>
          <Icon name="pause" size={16} className="text-text-secondary" />
          <Flag code={view.flagCode} size="xs" decorative />
          <div className={s.foldedText}>
            <h2 id={headingId} className={s.title}>
              {view.title}
            </h2>
            <div className={s.foldedNote}>{t('folded')}</div>
          </div>
          <button
            type="button"
            className={cn('t2f-focus', s.close)}
            aria-label={t('unfold', { title: view.title })}
            onClick={onUnfold}
          >
            <Icon name="expand" size={18} />
          </button>
        </div>
      ) : (
        bar
      )}
      <div className={cn(s.media, folded && s.mediaFolded)}>{view.endedCard ?? media}</div>
    </section>
  );
}
