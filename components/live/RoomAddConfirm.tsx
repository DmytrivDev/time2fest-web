'use client';

/**
 * Підтвердження «+» → кімната перегляду на телефоні (варіант B, дошка `Desk-Room-Plus-2`, рішення власника 2026-11-05):
 * під рядком трансляції, в одній картці з ним. «Кімната перегляду · 2 вікна · на телефоні до 2»; дві мініатюри 16:9 поруч —
 * «1 · звук» (що грає зараз) і «2 · додаєш» (жовта рамка) з назвами під ними; «Відкрити кімнату» на всю ширину,
 * «Скасувати» під нею. На десктопі «+» додає одразу — у панель кімнати (`RoomTray`).
 */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { StreamRowData } from '@/lib/live/countryData';
import { thumbOf } from '@/lib/live/thumb';
import s from './roomAddConfirm.module.css';

type TileRow = Pick<StreamRowData, 'id' | 'eventId' | 'title'>;

export interface RoomAddConfirmProps {
  id?: string;
  /** Трансляція, яку додаємо. */
  row: TileRow;
  /** Що грає зараз (перше вікно кімнати); невідоме — лише одна мініатюра. */
  current?: TileRow | null;
  onConfirm(): void;
  onCancel(): void;
  className?: string;
}

function Tile({ row, tag, accent }: { row: TileRow; tag: ReactNode; accent?: boolean }) {
  const src = thumbOf(row);
  return (
    <span className={s.tile}>
      <span className={cn(s.thumb, accent && s.thumbAccent)}>
        {src ? (
          // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" decoding="async" />
        ) : (
          <Icon name="broadcast" size={18} />
        )}
        <span className={cn(s.tag, accent && s.tagAccent)}>{tag}</span>
      </span>
      <span className={s.tileTitle}>{row.title}</span>
    </span>
  );
}

export function RoomAddConfirm({ id, row, current, onConfirm, onCancel, className }: RoomAddConfirmProps) {
  const t = useTranslations('country.streams.confirm');
  const two = !!current && current.id !== row.id;
  return (
    <div id={id} role="group" aria-labelledby={id ? `${id}-title` : undefined} data-room-confirm="" className={cn(s.box, className)}>
      <div className={s.head}>
        <span aria-hidden="true" className={s.icon}>
          <Icon name="grid4" size={18} />
        </span>
        <p id={id ? `${id}-title` : undefined} className={s.title}>
          {t('title')}
        </p>
        <span className={s.meta}>{t('meta')}</span>
      </div>
      <div aria-hidden="true" className={s.tiles}>
        {two && current ? (
          <Tile
            row={current}
            tag={
              <>
                <Icon name="speaker" size={12} />
                {t('now')}
              </>
            }
          />
        ) : null}
        <Tile row={row} tag={t('adding', { n: two ? 2 : 1 })} accent />
      </div>
      <button type="button" data-action="open-room" onClick={onConfirm} className={cn('t2f-focus t2f-press', s.open)}>
        <Icon name="grid4" size={18} />
        {t('open')}
      </button>
      <button type="button" onClick={onCancel} className={cn('t2f-focus', s.cancel)}>
        {t('cancel')}
      </button>
    </div>
  );
}
