'use client';

/**
 * Блок «Щоб додавати святкування у свій графік… потрібен Новорічний пас» з «Оформити пас · $5» і «Що ще дає пас» —
 * той самий, що в «Зараз і далі» на головній (`NowNext`, фільтр «Мій графік» без пасу); тут його беруть інші списки
 * (кімната: «Поточні трансляції»), щоб без пасу скрізь відкривалося одне й те саме (правка власника 2026-11-16).
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import s from './nowNext.module.css';

export function ScheduleLockedBar({
  stack = false,
  onGetPass,
  onInfo,
}: {
  /** Телефон: кнопки одна під одною. */
  stack?: boolean;
  onGetPass?: () => void;
  onInfo?: () => void;
}) {
  const t = useTranslations('liveCards.nowNext');
  return (
    <div role="status" data-row="mine-locked" className={cn(s.lockedBar, stack && s.lockedBarStack)}>
      <Icon name="lock" size={18} className="mt-0.5 shrink-0 text-highlight" />
      <p className={s.lockedText}>{t.rich('mineLockedText', { b: (c) => <b className="font-bold">{c}</b> })}</p>
      <span className={s.lockedActions}>
        {onGetPass ? (
          <Button variant="coral" compact iconLeft="ticket" data-action="get-pass" onClick={onGetPass}>
            {t('mineLockedGet', { price: formatUsd(PASS_PRICE) })}
          </Button>
        ) : null}
        <Button variant="tonal" compact data-action="pass-info" onClick={onInfo}>
          {t('mineLockedButton')}
        </Button>
      </span>
    </div>
  );
}
