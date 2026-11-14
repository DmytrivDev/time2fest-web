import type { Metadata } from 'next';
import { CountryList } from '@/components/countries/CountryList';

export const metadata: Metadata = {
  title: 'Країни й міста',
  description: 'Пояси по черзі: країни, міста й трансляції Нового року за вашим часом.',
};

/** Країни й міста (S-COUNTRIES / S-LIST, ІНВ C19): довідник країн за поясами — `components/countries/CountryList.tsx`. Плеєра немає; чат — як на головній. */
export default function CountriesPage() {
  return <CountryList />;
}
