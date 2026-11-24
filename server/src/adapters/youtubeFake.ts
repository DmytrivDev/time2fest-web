/**
 * Adapter for the fake YouTube server (ring 4, SPEC-12 AC-71): the same mapping as the real adapter, no key, loopback only.
 */
import { createYoutubeDataSource, type YoutubeSource } from './youtubeData';

export function createYoutubeFakeSource(baseUrl: string): YoutubeSource {
  return createYoutubeDataSource({ baseUrl });
}
