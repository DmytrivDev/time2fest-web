/**
 * Домени з адаптером `http`. Без імпортів значень: список читає й `next.config.ts` (розклад інтеграційної збірки).
 * `httpFactories` (`./index.ts`) типізовано цим списком — розійтися вони не можуть.
 */
import type { ServiceName } from '../services';

export const HTTP_DOMAINS = ['catalog', 'site', 'live'] as const satisfies readonly ServiceName[];

export type HttpDomain = (typeof HTTP_DOMAINS)[number];
