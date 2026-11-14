'use client';

/**
 * Вільне місце й «Повернути» — розміром із вікно (дошки `Desk-Room-New`, `Desk-Room-Notices`, власник 2026-11-05).
 *
 * `SlotTile` — без фото: «+», «Додати трансляцію», прапори країн, що зараз наживо, і їх кількість. Стани:
 * - `live` — є що додати; `one` — наживо одна трансляція (назва);
 * - `all-in` — усе, що наживо, уже в кімнаті: «+» неактивний, «Наступні трансляції — о 03:00»;
 * - `none` — наживо нікого: найближча трансляція й «Додати в графік».
 * `UndoTile` — на місці прибраного вікна 6 с: «Вікно прибрано · Повернути» (смужка відліку), потім сітка перебудовується.
 */
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import s from '@/components/room/room.module.css';

export type SlotState =
  | { kind: 'live'; count: number; flags: readonly string[] }
  | { kind: 'one'; title: string }
  | { kind: 'all-in'; next: string | null }
  | { kind: 'none'; next: { title: string; time: string } | null };

export interface SlotTileProps {
  state: SlotState;
  order: number;
  /** Місце в сітці (сюди можна перетягнути вікно). */
  pos?: number;
  /** Над місцем тягнуть вікно. */
  dropTarget?: boolean;
  phone: boolean;
  onAdd(): void;
  onSchedule?(): void;
}

export function SlotTile({
  state,
  order,
  pos,
  dropTarget = false,
  phone,
  onAdd,
  onSchedule,
}: SlotTileProps) {
  const t = useTranslations('room.slot');
  const style: CSSProperties = { order };
  const off = state.kind === 'all-in' || state.kind === 'none';
  const line = (() => {
    switch (state.kind) {
      case 'live':
        return (
          <>
            <span className={s.flags} aria-hidden="true">
              {state.flags.slice(0, 5).map((f) => (
                <Flag key={f} code={f} size="xs" decorative />
              ))}
            </span>
            <span>{t.rich('liveCount', { count: state.count, b: (c) => <b>{c}</b> })}</span>
          </>
        );
      case 'one':
        return (
          <>
            <Icon name="broadcast-live" size={16} className="text-primary" />
            <span>{t.rich('liveOne', { title: state.title, b: (c) => <b>{c}</b> })}</span>
          </>
        );
      case 'all-in':
        return state.next ? (
          <span>{t.rich('nextAt', { time: state.next, b: (c) => <b>{c}</b> })}</span>
        ) : null;
      case 'none':
        return state.next ? (
          <span>
            {t.rich('nearest', {
              title: state.next.title,
              time: state.next.time,
              b: (c) => <b>{c}</b>,
            })}
          </span>
        ) : null;
    }
  })();
  const body = (extra?: ReactNode) => (
    <span className={s.slotInner}>
      <span className={s.slotCircle} aria-hidden="true">
        <Icon name={off ? 'clock' : 'plus'} size={off ? 22 : 32} />
      </span>
      <span className={s.slotTitle}>
        {state.kind === 'all-in' ? t('allIn') : state.kind === 'none' ? t('none') : t('add')}
      </span>
      {line ? <span className={s.slotLine}>{line}</span> : null}
      {extra}
    </span>
  );
  if (off) {
    return (
      <div
        data-room-slot=""
        data-room-pos={pos}
        data-drop={dropTarget || undefined}
        data-slot-state={state.kind}
        style={style}
        className={cn(s.slot, s.slotOff, phone && s.slotPhone)}
      >
        {body(
          state.kind === 'none' && onSchedule ? (
            <Button variant="secondary" compact iconLeft="calendar-add" onClick={onSchedule}>
              {t('schedule')}
            </Button>
          ) : null,
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-room-slot=""
      data-room-pos={pos}
      data-drop={dropTarget || undefined}
      data-slot-state={state.kind}
      style={style}
      className={cn('t2f-focus', s.slot, phone && s.slotPhone)}
      onClick={onAdd}
    >
      {body()}
    </button>
  );
}

export interface UndoTileProps {
  title: string;
  order: number;
  onUndo(): void;
}

export function UndoTile({ title, order, onUndo }: UndoTileProps) {
  const t = useTranslations('room.undo');
  return (
    <div data-room-undo="" role="status" style={{ order }} className={s.undo}>
      <span className={s.slotInner}>
        <span className={s.undoCircle} aria-hidden="true">
          <Icon name="check" size={22} />
        </span>
        <span className={s.slotTitle}>{t('removed')}</span>
        <span className={s.slotLine}>{title}</span>
        <Button variant="tonal" iconLeft="undo" onClick={onUndo}>
          {t('undo')}
        </Button>
      </span>
      <span className={cn(s.progress, s.progressGrey)} aria-hidden="true" />
    </div>
  );
}
