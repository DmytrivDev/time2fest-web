/**
 * Статичні дані області: файли `web/data/*.json` імпортуються під час збирання,
 * індекси будуються один раз (`buildDataset`). Форма та сама, що пізніше віддаватиме Payload.
 */
import countriesJson from '@/data/countries.json';
import scheduleJson from '@/data/schedule.json';
import streamsJson from '@/data/streams.json';
import { buildDataset } from './build';
import type { CountriesFile, Dataset, ScheduleFile, StreamsFile } from './types';

export { buildDataset } from './build';

export const data: Dataset = buildDataset(
  scheduleJson as unknown as ScheduleFile,
  countriesJson as unknown as CountriesFile,
  streamsJson as unknown as StreamsFile,
);

export function getData(): Dataset {
  return data;
}
