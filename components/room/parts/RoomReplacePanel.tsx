'use client';

/**
 * Кімната повна → «Що замінити?» (дошка `Desk-Room-Notices`, варіант C, власник 2026-11-05). Одне місце для вибору:
 * на місці чату (десктоп, видно завжди — навіть коли сторінку прокручено) і в шторці (телефон). Згори — що додаєш,
 * під ним — схема вікон кімнати (2×2 на десктопі, 2 на телефоні): натиск на вікно — заміна. Лише «Скасувати»;
 * на смугах самих вікон кнопок заміни немає (без дублювання).
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import s from '@/components/room/room.module.css';

export interface ReplaceTileData {
  slot: number;
  /** Номер місця в сітці, з 1 (1 — головне). */
  position: number;
  title: string;
  flagCode: string;
  thumb?: string;
  hasSound: boolean;
}

export interface RoomReplacePanelProps {
  adding: { title: string; flagCode: string; thumb?: string };
  windows: readonly ReplaceTileData[];
  phone: boolean;
  onPick(slot: number): void;
  onCancel(): void;
}

export function RoomReplacePanel({
  adding,
  windows,
  phone,
  onPick,
  onCancel,
}: RoomReplacePanelProps) {
  const t = useTranslations('room.replace');
  return (
    <div data-room-replace="" className={s.replace}>
      <div className={s.adding}>
        <span className={s.addingThumb}>
          {adding.thumb ? (
            // Мініатюра YouTube: зовнішня адреса.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={adding.thumb} alt="" loading="lazy" />
          ) : null}
        </span>
        <div className="min-w-0">
          <div className="text-caption text-text-muted">{t('adding')}</div>
          <div className="flex items-center gap-1.5 text-body-strong text-text">
            <Flag code={adding.flagCode} size="xs" decorative />
            <span className="truncate">{adding.title}</span>
          </div>
        </div>
      </div>
      <p className={s.hint}>{phone ? t('hintPhone') : t('hint')}</p>
      <ul className={cn('m-0 list-none p-0', s.tiles)}>
        {windows.map((w) => (
          // Плитка стоїть на тому самому місці, що вікно в сітці: номер = місце, а не порядок.
          <li key={w.slot} className="flex min-w-0" style={{ order: w.position }}>
            <button
              type="button"
              data-replace-slot={w.slot}
              className={cn('t2f-focus', s.tile)}
              aria-label={t('pickLabel', { position: w.position, title: w.title })}
              onClick={() => onPick(w.slot)}
            >
              <span className={s.tileThumb}>
                {w.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.thumb} alt="" loading="lazy" />
                ) : null}
                {w.hasSound ? (
                  <span className={s.tileSound} aria-hidden="true">
                    <Icon name="speaker" size={12} />
                  </span>
                ) : null}
                <span className={s.tileNo} aria-hidden="true">
                  {w.position}
                </span>
              </span>
              <span className={s.tileName}>
                <Flag code={w.flagCode} size="xs" decorative />
                <span>{w.title}</span>
              </span>
              <span className={s.tileBtn} aria-hidden="true">
                <Icon name="swap" size={12} />
                {t('replace')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {phone ? <p className={s.hint}>{t('limitNote')}</p> : null}
      <Button variant="secondary" onClick={onCancel}>
        {t('cancel')}
      </Button>
    </div>
  );
}
