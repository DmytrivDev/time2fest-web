/** Вікно кімнати завершується через 15 хв після півночі, якщо трансляція вже не йде; наживо — лишається. */
import { describe, expect, it } from 'vitest';
import type { StreamSource } from '@/lib/data/types';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { registerRecording, setRecordingClock } from '@/lib/player/recordingSync';
import { windowEndedAt } from '@/lib/room/windowEnd';

const MID = Date.UTC(2026, 11, 31, 23, 0, 0);
const event = { midnightUtc: new Date(MID).toISOString(), midnightMs: MID };
const src = (over: Partial<StreamSource> = {}): StreamSource => ({
  id: 's1',
  platform: 'youtube',
  videoId: 'vid',
  url: 'https://youtu.be/vid',
  kind: 'main',
  title: { uk: 'Тест' },
  order: 1,
  status: 'live',
  embeddable: true,
  lastChecked: new Date(MID).toISOString(),
  verified: true,
  isLive: true,
  ...over,
});

describe('windowEndedAt', () => {
  it('до 15 хв після півночі вікно не завершене', () => {
    expect(windowEndedAt(MID + HANDOVER_AFTER - 1, event, src({ isLive: false, status: 'possible' }))).toBeNull();
  });
  it('через 15 хв, якщо трансляція не йде, — завершене від північ + 15 хв', () => {
    expect(windowEndedAt(MID + HANDOVER_AFTER + 5_000, event, src({ isLive: false, status: 'live' }))).toBe(MID + HANDOVER_AFTER);
  });
  it('трансляція ще йде наживо — вікно лишається', () => {
    expect(windowEndedAt(MID + 2 * HANDOVER_AFTER, event, src())).toBeNull();
  });
  it('запис, що дійшов до кінця, — завершене; пізніше — ні', () => {
    registerRecording('rec-vid', { midnightMs: MID, midnightSec: 100, durationSec: 100 + 20 * 60 });
    setRecordingClock(() => MID);
    const s = src({ videoId: 'rec-vid' });
    expect(windowEndedAt(MID + 16 * 60_000, event, s)).toBeNull();
    expect(windowEndedAt(MID + 21 * 60_000, event, s)).toBe(MID + HANDOVER_AFTER);
  });
  it('джерела немає — завершене після 15 хв', () => {
    expect(windowEndedAt(MID + HANDOVER_AFTER, event, undefined)).toBe(MID + HANDOVER_AFTER);
  });
});
