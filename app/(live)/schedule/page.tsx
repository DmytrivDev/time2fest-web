import type { Metadata } from 'next';
import { SchedulePage } from '@/components/schedule/SchedulePage';

export const metadata: Metadata = { title: 'Мій графік — Time2Fest', robots: { index: false, follow: false } };

/** «Мій графік»: `components/schedule/SchedulePage.tsx` (поки порожня сторінка). Плеєра немає; чат — як на «Країнах і містах». */
export default function Schedule() {
  return <SchedulePage />;
}
