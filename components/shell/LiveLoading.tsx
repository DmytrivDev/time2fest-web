'use client';

/**
 * Скелетон групи `(live)` за адресою (правка власника 2026-11-05): на «Країнах і містах» — скелетон цієї сторінки (той самий
 * верх і рядки поясів), а не скелетон головної з плеєром; деінде — як було (`PageSkeleton`).
 */
import { usePathname } from 'next/navigation';
import { CountriesSkeleton } from '@/components/live/CountriesSkeleton';
import { PageSkeleton } from './Skeleton';

export function LiveLoading() {
  const path = usePathname() ?? '';
  if (/^\/countries\/?$/.test(path)) return <CountriesSkeleton />;
  return <PageSkeleton mode="embedded" />;
}
