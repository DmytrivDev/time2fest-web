import { PageSkeleton } from '@/components/shell/Skeleton';

/** Скелетон групи `(live)` (C24): шапка, чат і футер — з макета; тут лише вміст сторінки під плеєром. */
export default function Loading() {
  return <PageSkeleton mode="embedded" />;
}
