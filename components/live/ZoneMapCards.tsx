'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatTimeForViewer } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';

/** «північ о 02:00 за вашим часом» (з датою, якщо це інший день). */
export function useMidnightPhrase(midnightMs: number): string {
  const t = useTranslations('liveMap');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });
  const v = formatTimeForViewer(midnightMs, { now: now > 0 ? now : midnightMs, locale });
  return v.date ? t('midnightAtDate', { date: v.date, time: v.time }) : t('midnightAt', { time: v.time });
}
