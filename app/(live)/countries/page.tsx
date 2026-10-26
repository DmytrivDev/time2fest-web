import type { Metadata } from 'next';
import { CountryList } from '@/components/live/CountryList';

export const metadata: Metadata = {
  title: 'Країни й міста',
  description: 'Пояси по черзі: країни, міста й трансляції Нового року за вашим часом.',
};

/** Країни й міста (S-COUNTRIES / S-LIST, ІНВ C19): склад сторінки — `components/live/CountryList.tsx`. Плеєра й чату тут немає. */
export default function CountriesPage() {
  return <CountryList />;
}
