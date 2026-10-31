'use client';

/**
 * O-SCHEDULE-GATE «Графік — у Новорічному пасі» за дошкою `Desk-NowNext-Schedule` (рішення власника 2026-10-31):
 * без пасу натиск на календар картки відкриває вікно на місці чату (телефон — шторкою), а не плашку над «Першим рядом».
 * Графіка без пасу немає, тож показуємо, як він виглядатиме: місто, яке людина додає, — першим, решта — підписані
 * порожні місця. Переваги графіка, рядок про решту пасу, «Усе про пас» (спокійна кнопка), унизу — «Оформити пас» і
 * «Закрити». Безплатного нагадування тут немає (правка власника).
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import win from './scheduleGate.module.css';

export interface ScheduleGateProps {
  /** Місто, яке людина хотіла додати (називний відмінок); без нього (відкрито з «Мій графік») — порожні місця. */
  city?: string;
  flagCode?: string;
  /** Північ за часом гостя («05:00»). */
  time?: string;
  onGetPass(): void;
  onPassInfo(): void;
  onClose(): void;
  className?: string;
}

const BENEFITS: { key: 'list' | 'remind' | 'filter'; icon: IconName }[] = [
  { key: 'list', icon: 'calendar-check' },
  { key: 'remind', icon: 'bell' },
  { key: 'filter', icon: 'filter' },
];

export function ScheduleGate({ city, flagCode, time, onGetPass, onPassInfo, onClose, className }: ScheduleGateProps) {
  const t = useTranslations('pass.scheduleGate');
  return (
    <section data-window="O-SCHEDULE-GATE" className={cn('flex min-h-full flex-col', className)}>
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-3.5">
        <div className={win.preview} data-row="preview">
          <p className={win.previewTitle}>{t('previewTitle')}</p>
          {city ? (
            <div className={cn(win.row, win.rowOn)}>
              <Flag code={flagCode ?? 'UN'} size="card" decorative />
              <span className={win.rowCity}>{city}</span>
              <span className={win.rowTime}>{time}</span>
              <Icon name="bell" size={14} className="text-highlight" />
            </div>
          ) : null}
          {(city ? [t('nextCity'), t('oneMoreCity')] : [t('firstCity'), t('nextCity'), t('oneMoreCity')]).map((label) => (
            <div key={label} aria-hidden="true" className={cn(win.row, win.rowEmpty)}>
              <span className={win.flagStub} />
              <span className={win.rowCity}>{label}</span>
              <span className={win.rowTime}>--:--</span>
              <Icon name="bell" size={14} />
            </div>
          ))}
          <p className={win.previewNote}>{city ? t('previewNote') : t('previewNoteEmpty')}</p>
        </div>
        <ul aria-label={t('benefitsLabel')} className="m-0 flex list-none flex-col gap-3 p-0">
          {BENEFITS.map(({ key, icon }, i) => (
            <li key={key} className="flex items-start gap-3">
              <span aria-hidden="true" className={cn(win.tile, i === 0 && win.tileHot)}>
                <Icon name={icon} size={18} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={win.perkTitle}>{t(`${key}Title`)}</span>
                <span className={win.perkText}>{t(`${key}Text`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={win.more}>{t('more')}</p>
        <Button variant="tonal" compact iconLeft="ticket" data-action="pass-info" onClick={onPassInfo} className="self-start">
          {t('passInfo')}
          <Icon name="chevron-right" size={14} className="text-text-muted" />
        </Button>
      </div>
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-border bg-surface px-4 pb-4 pt-3" data-row="buy">
        <Button variant="coral" size="lg" iconLeft="ticket" data-action="get-pass" onClick={onGetPass} className="w-full">
          {t('get', { price: formatUsd(PASS_PRICE) })}
        </Button>
        <Button variant="secondary" size="lg" data-action="close" onClick={onClose} className="w-full">
          {t('close')}
        </Button>
        <p className={win.note}>{t('note')}</p>
      </div>
    </section>
  );
}
