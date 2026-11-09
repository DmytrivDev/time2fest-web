import type { Metadata } from 'next';
import { AboutPage } from '@/components/about/AboutPage';

export const metadata: Metadata = { title: 'Про нас — Time2Fest', description: 'Time2Fest — Новий рік по всьому світу: північ за північчю, живі трансляції з усіх часових поясів.' };

/** Сторінка «Про нас» (2026-11-09): проста заглушка в оболонці службових сторінок. */
export default function Page() {
  return <AboutPage />;
}
