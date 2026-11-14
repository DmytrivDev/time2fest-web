/** Розділи кабінету: id (збігається з id секції на сторінці) і значок у меню. */

import type { IconName } from '@/components/primitives/Icon';

export const SECTIONS = [
  { id: 'profile', icon: 'user' },
  { id: 'settings', icon: 'filter' },
  { id: 'notifications', icon: 'bell' },
  { id: 'data', icon: 'shield-check' },
] as const satisfies readonly { id: string; icon: IconName }[];
export type SectionId = (typeof SECTIONS)[number]['id'];
