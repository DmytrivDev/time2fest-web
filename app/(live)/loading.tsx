import { LiveLoading } from '@/components/shell/LiveLoading';

/**
 * Скелетон групи `(live)` (C24): шапка, чат і футер — з макета; тут лише вміст сторінки — за адресою (`LiveLoading`).
 * Головна бере саме його; інші сторінки мають власний `loading.tsx` у сегменті (2026-11-10).
 */
export default function Loading() {
  return <LiveLoading />;
}
