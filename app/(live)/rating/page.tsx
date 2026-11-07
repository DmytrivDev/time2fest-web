import type { Metadata } from 'next';
import { RatingPage } from '@/components/rating/RatingPage';

export const metadata: Metadata = { title: 'Рейтинг святкувань — Time2Fest' };

/** «Рейтинг святкувань» — у макеті `(live)` з чатом праворуч (рішення власника 2026-11-07). */
export default function Rating() {
  return <RatingPage />;
}
