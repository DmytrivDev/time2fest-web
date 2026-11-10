import { AuthSkeleton } from '@/components/skeleton/StaticSkeletons';

/** Скелетон сторінки «Створити акаунт» (2026-11-10): шапка й сітка самої сторінки, замість вмісту — бруски. */
export default function Loading() {
  return <AuthSkeleton mode="signup" />;
}
