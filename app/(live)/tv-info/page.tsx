import type { Metadata } from 'next';
import { TvPhoneInfo } from '@/components/tv/TvPhoneInfo';

export const metadata: Metadata = {
  title: 'Режим вечірки — як увімкнути — Time2Fest',
  description: 'Новий рік на великому екрані: як увімкнути режим вечірки на телевізорі, ноутбуці чи через трансляцію екрана.',
};

/** Інформаційна сторінка режиму вечірки (`/tv` на телефоні веде сюди): `components/tv/TvPhoneInfo.tsx`. Плеєра немає; чат — як на «Країнах і містах». */
export default function TvInfoPage() {
  return <TvPhoneInfo />;
}
