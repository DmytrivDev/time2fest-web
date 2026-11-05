'use client';

/**
 * Підтвердження «+» → кімната перегляду (правка власника 2026-11-05: попереднє — просто текст і дві кнопки — виглядало
 * недоробленим). Заголовок з іконкою кімнати, дві мініатюри поруч — що грає зараз і що додаємо (так видно, що буде у
 * двох вікнах), коротке пояснення, «Відкрити кімнату» і «Скасувати». Один вигляд у картках трансляцій (десктоп — під «+»,
 * телефон — під рядком) і в списку «Обрати трансляцію».
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { StreamRowData } from '@/lib/live/countryData';
import { thumbOf } from '@/lib/live/thumb';
import s from './roomAddConfirm.module.css';

export interface RoomAddConfirmProps {
  id?: string;
  /** Трансляція, яку додаємо. */
  row: StreamRowData;
  /** Що грає зараз (головне вікно кімнати); невідоме — лише одна мініатюра. */
  current?: Pick<StreamRowData, 'id' | 'eventId' | 'title'> | null;
  onConfirm(): void;
  onCancel(): void;
  className?: string;
}

function Tile({ row, label, accent }: { row: Pick<StreamRowData, 'id' | 'eventId' | 'title'>; label: string; accent?: boolean }) {
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
        <span className={cn(s.tag, accent && s.tagAccent)}>{label}</span>
      </span>
      <span className={s.tileTitle}>{row.title}</span>
    </span>
  );
}

export function RoomAddConfirm({ id, row, current, onConfirm, onCancel, className }: RoomAddConfirmProps) {
  const t = useTranslations('country.streams.confirm');
  return (
    <div id={id} role="group" aria-labelledby={id ? `${id}-title` : undefined} data-room-confirm="" className={cn(s.box, className)}>
      <div className={s.head}>
        <span aria-hidden="true" className={s.icon}>
          <Icon name="grid4" size={18} />
        </span>
        <p id={id ? `${id}-title` : undefined} className={s.title}>
          {t('title')}
        </p>
      </div>
      <div aria-hidden="true" className={s.tiles}>
        {current && current.id !== row.id ? <Tile row={current} label={t('now')} /> : null}
        {current && current.id !== row.id ? (
          <span className={s.plus}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
          </span>
        ) : null}
        <Tile row={row} label={t('adding')} accent />
      </div>
      <p className={s.note}>{t('note')}</p>
      <div className={s.actions}>
        <Button variant="tonal" iconLeft="grid4" onClick={onConfirm} className={s.open}>
          {t('open')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}
