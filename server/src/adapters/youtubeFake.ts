/**
 * Adapter for the fake YouTube server (ring 4, SPEC-12 AC-71): the same mapping as the real adapter, no key, loopback only.
 */
import type { SearchSource, VideoStatusSource } from '../live/ports';
import { createYoutubeDataSource } from './youtubeData';

export function createYoutubeFakeSource(baseUrl: string): VideoStatusSource & SearchSource {
  return createYoutubeDataSource({ baseUrl });
}
