'use client';

/**
 * «Сервер» рейтингу в імітації: щосекунди (за годинником сайту) розсилає свіжі агрегати — святкування відкривається
 * в рейтингу через 15 с після півночі, оцінок світу більшає (`lib/api/sim/rating.ts`). Колись цю роботу робив
 * `useMemo` у `RatingPage` на такті годинника.
 */
import { useLayoutEffect } from 'react';
import { useNow } from '@/lib/time/TimeProvider';
import { setSimRatingNow } from './rating';

export function RatingTicker() {
  const now = useNow();
  const second = Math.floor(now / 1000) * 1000;
  // Layout-ефект: час відомий імітації до того, як перший споживач рейтингу (пасивний ефект) попросить дошку.
  useLayoutEffect(() => {
    setSimRatingNow(second);
  }, [second]);
  return null;
}
