/** AC-1: the public surface of `@time2fest/rules/time` — every rule and constant the spec lists is exported. */
import { describe, expect, it } from 'vitest';
import {
  // celebration bounds (±2 h), celebration phase and toast season
  CELEBRATION_LEAD,
  CELEBRATION_TAIL,
  isCelebrating,
  toastsOpenAt,
  canSayToast,
  toastSeason,
  // event status and phases, moment timeline (§2.3)
  midnightOf,
  eventStatus,
  toRuntime,
  handoverMoment,
  captionPhase,
  momentTimeline,
  momentState,
  momentStage,
  // air slot and zone state
  currentSlotIndex,
  isZonePast,
  zoneState,
  // pinnedUntil with next / previous midnight
  pinnedUntilAt,
  nextMidnightAfter,
  prevMidnightAtOrBefore,
  // client surface presence rule
  presenceOf,
  presenceMoment,
  presentEvents,
  // server pulse presence rule and stamp moment
  isPresentByPulses,
  stampGrantedAt,
  stampAcceptUntil,
  // rating open / close
  RATING_OPEN_AFTER,
  RATING_CLOSE_AFTER,
  ratingCloseAt,
  isRatingOpenFor,
  isRatingClosed,
  // offer time bounds (+5 min, −10 min before next)
  OFFER_MIN_AFTER,
  OFFER_MIN_BEFORE_NEXT,
  offerEarliestAt,
  isTooCloseToNextForOffer,
  // schedule close (2 min before midnight)
  SCHEDULE_CLOSE_MS,
  isScheduleClosed,
  // stamp catch-up max age (30 min)
  CATCH_UP_MAX_AGE_MS,
  isStampTooOldToCelebrate,
  // arrived year
  arrivedYear,
  // server default Δ
  SERVER_CLOCK_TOLERANCE_MS,
  assertTolerance,
  assertPulseInterval,
  // durations
  HOWTO_BEFORE,
  STAMP_DELAY,
  RATE_OPEN_AFTER,
  RATE_DURATION,
  HANDOVER_AFTER,
  LAST_MINUTE_FROM,
  RECORDING_AFTER,
  DELAY_NOTICE_FROM,
  // divergent rules under their own names (AC-7)
  zonePassedHandover,
  defaultCountryZone,
  isInReminderWindow,
} from '@time2fest/rules/time';

const surface = {
  CELEBRATION_LEAD,
  CELEBRATION_TAIL,
  isCelebrating,
  toastsOpenAt,
  canSayToast,
  toastSeason,
  midnightOf,
  eventStatus,
  toRuntime,
  handoverMoment,
  captionPhase,
  momentTimeline,
  momentState,
  momentStage,
  currentSlotIndex,
  isZonePast,
  zoneState,
  pinnedUntilAt,
  nextMidnightAfter,
  prevMidnightAtOrBefore,
  presenceOf,
  presenceMoment,
  presentEvents,
  isPresentByPulses,
  stampGrantedAt,
  stampAcceptUntil,
  RATING_OPEN_AFTER,
  RATING_CLOSE_AFTER,
  ratingCloseAt,
  isRatingOpenFor,
  isRatingClosed,
  OFFER_MIN_AFTER,
  OFFER_MIN_BEFORE_NEXT,
  offerEarliestAt,
  isTooCloseToNextForOffer,
  SCHEDULE_CLOSE_MS,
  isScheduleClosed,
  CATCH_UP_MAX_AGE_MS,
  isStampTooOldToCelebrate,
  arrivedYear,
  SERVER_CLOCK_TOLERANCE_MS,
  assertTolerance,
  assertPulseInterval,
  HOWTO_BEFORE,
  STAMP_DELAY,
  RATE_OPEN_AFTER,
  RATE_DURATION,
  HANDOVER_AFTER,
  LAST_MINUTE_FROM,
  RECORDING_AFTER,
  DELAY_NOTICE_FROM,
  zonePassedHandover,
  defaultCountryZone,
  isInReminderWindow,
};

describe('AC-1 exports of @time2fest/rules/time', () => {
  it.each(Object.entries(surface))('%s is defined', (_name, value) => {
    expect(value).toBeDefined();
  });
  it('constants are finite numbers, rules are functions', () => {
    for (const [name, value] of Object.entries(surface)) {
      if (/^[A-Z_]+$/.test(name)) expect(Number.isFinite(value), name).toBe(true);
      else expect(typeof value, name).toBe('function');
    }
  });
});
