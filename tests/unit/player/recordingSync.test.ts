import { describe, expect, it, vi } from 'vitest';
import { notifyRecordingResync, onRecordingResync, recordingPosition, registerRecording, REPLAY_LEAD_SEC } from '@/lib/player/recordingSync';

const MIDNIGHT = Date.parse('2026-12-31T23:00:00Z');

describe('recordingSync: запис свята грає синхронно з північчю (демо 2026-11-11)', () => {
  registerRecording('vid-paris', { midnightMs: MIDNIGHT, midnightSec: 508, durationSec: 1151 });

  it('за хвилину до півночі — секунда півночі мінус 60', () => {
    expect(recordingPosition('vid-paris', MIDNIGHT - 60_000)).toEqual({ seconds: 448, mode: 'live' });
  });

  it('до початку запису — з початку', () => {
    expect(recordingPosition('vid-paris', MIDNIGHT - 20 * 60_000)).toEqual({ seconds: 0, mode: 'live' });
  });

  it('після кінця запису — повтор від відліку', () => {
    expect(recordingPosition('vid-paris', MIDNIGHT + 60 * 60_000)).toEqual({ seconds: 508 - REPLAY_LEAD_SEC, mode: 'replay' });
  });

  it('не запис — undefined; стрибок часу сповіщає плеєри', () => {
    expect(recordingPosition('other', MIDNIGHT)).toBeUndefined();
    const l = vi.fn();
    const off = onRecordingResync(l);
    notifyRecordingResync();
    off();
    notifyRecordingResync();
    expect(l).toHaveBeenCalledTimes(1);
  });
});
