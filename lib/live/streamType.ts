import type { CelebrationType } from '@/lib/data/types';

/**
 * Тип святкування / трансляції → ключ підпису в `liveCards.eventCard.type` («Головне святкування», «Вебкамера», «ТБ»,
 * «Лише відлік»). Один словник на всі картки (подій, трансляцій, мапи, ТВ, графіка).
 */
export const STREAM_TYPE_KEY = {
  main: 'main',
  webcam: 'webcam',
  tv: 'tv',
  'countdown-only': 'countdownOnly',
} as const satisfies Record<CelebrationType, string>;
