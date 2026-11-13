import { getStreamChains } from '@/lib/api/hooks/live';
import type { StreamRowData } from '@/lib/live/countryData';

/** Мініатюра YouTube джерела (mqdefault, 320 × 180); інші платформи — немає. */
export function thumbOf(row: Pick<StreamRowData, 'id' | 'eventId'>): string | undefined {
  const src = getStreamChains().get(row.eventId)?.sources.find((x) => x.id === row.id);
  return src?.platform === 'youtube' && src.videoId ? `https://i.ytimg.com/vi/${src.videoId}/mqdefault.jpg` : undefined;
}
