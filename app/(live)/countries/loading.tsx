import { CountriesSkeleton } from '@/components/live/CountriesSkeleton';

/** Скелетон «Країн і міст» — той самий верх і рядки поясів, що після завантаження (не скелетон головної з плеєром). */
export default function Loading() {
  return <CountriesSkeleton />;
}
