'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { formatTimeForViewer } from '@/lib/i18n/time';
import type { ZoneState } from '@/lib/engine/zoneState';
import { useNow } from '@/lib/time/TimeProvider';

const STATE_ICON: Record<ZoneState, IconName | null> = { past: 'check', live: null, next: 'clock', future: null };

/** Стан поясу текстом (+ іконка): колір ніколи не єдина ознака. «Наживо» — стандартна позначка. */
export function ZoneStateLabel({ state, className }: { state: ZoneState; className?: string }) {
  const t = useTranslations('liveMap.legend');
  const tBadge = useTranslations('primitives.badge');
  if (state === 'live') return <Badge variant="live" className={className}>{tBadge('live')}</Badge>;
  const icon = STATE_ICON[state];
  return (
    <span data-zone-state-label={state} className={cn('inline-flex items-center gap-1.5 text-label-sm text-text-secondary', className)}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {t(state)}
    </span>
  );
}

/** «північ о 02:00 за вашим часом» (з датою, якщо це інший день). */
export function useMidnightPhrase(midnightMs: number): string {
  const t = useTranslations('liveMap');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });
  const v = formatTimeForViewer(midnightMs, { now: now > 0 ? now : midnightMs, locale });
  return v.date ? t('midnightAtDate', { date: v.date, time: v.time }) : t('midnightAt', { time: v.time });
}
