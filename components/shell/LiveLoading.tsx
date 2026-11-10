'use client';

/**
 * Скелетон групи `(live)` за адресою (правка власника 2026-11-05, розширено 2026-11-10): кожна сторінка має свій
 * `loading.tsx` у сегменті, а ця межа групи спрацьовує, лише коли чекає щось вище (напр. перехід ззовні групи) — тоді
 * показуємо скелетон тієї сторінки, куди йдемо, а не загальний.
 */
import { usePathname } from 'next/navigation';
import { CountriesSkeleton } from '@/components/live/CountriesSkeleton';
import {
  AccountSkeleton,
  CountrySkeleton,
  HomeSkeleton,
  PassportSkeleton,
  RatingSkeleton,
  RoomSkeleton,
  ScheduleSkeleton,
  SupportSkeleton,
  TvInfoSkeleton,
  liveSkeletonFor,
} from '@/components/skeleton/LiveSkeletons';

const BY_KIND = {
  home: HomeSkeleton,
  country: CountrySkeleton,
  countries: CountriesSkeleton,
  room: RoomSkeleton,
  schedule: ScheduleSkeleton,
  passport: PassportSkeleton,
  rating: RatingSkeleton,
  support: SupportSkeleton,
  account: AccountSkeleton,
  'tv-info': TvInfoSkeleton,
} as const;

export function LiveLoading() {
  const Skeleton = BY_KIND[liveSkeletonFor(usePathname() ?? '/')];
  return <Skeleton />;
}
