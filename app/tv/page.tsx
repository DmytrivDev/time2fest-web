import type { Metadata } from 'next';
import { TvScreen } from '@/components/tv/TvScreen';

export const metadata: Metadata = {
  title: 'Режим вечірки — Time2Fest',
  robots: { index: false, follow: false },
};

/** Режим вечірки (S-TV): склад сторінки — `components/tv/TvScreen.tsx` (C22). */
export default function TvPage() {
  return <TvScreen />;
}
