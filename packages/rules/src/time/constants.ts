const SEC = 1_000;
const MIN = 60 * SEC;

/** «How to celebrate» opens 15 min before midnight. */
export const HOWTO_BEFORE = 15 * MIN;
/** Stamp and system message come 15 s after midnight. */
export const STAMP_DELAY = 15 * SEC;
/** Presence beat interval near midnight, I = 20 s (SPEC-14 [А2]). */
export const PULSE_INTERVAL_MS = 20 * SEC;
/** Rating prompt opens 5 min after midnight… */
export const RATE_OPEN_AFTER = 5 * MIN;
/** …and lasts 3 min. */
export const RATE_DURATION = 3 * MIN;
/** Offers: not earlier than 5 min after the event… */
export const OFFER_MIN_AFTER = 5 * MIN;
/** …and not later than 10 min before the next one. */
export const OFFER_MIN_BEFORE_NEXT = 10 * MIN;
/** The air hands over to the next event 15 min after midnight. */
export const HANDOVER_AFTER = 15 * MIN;
/** «Last minute» starts at +14 min. */
export const LAST_MINUTE_FROM = 14 * MIN;
/** «Recording» after midnight (assumption, data-model 1.4). */
export const RECORDING_AFTER = 30 * MIN;
/** «Video may be late» from −5 min to +15 s. */
export const DELAY_NOTICE_FROM = 5 * MIN;

/** The celebration starts this long before the first midnight. */
export const CELEBRATION_LEAD = 2 * 60 * 60 * 1_000;
/** The celebration lasts this long after the last midnight. */
export const CELEBRATION_TAIL = 2 * 60 * 60 * 1_000;

/** A celebration appears in the rating 15 s after midnight. */
export const RATING_OPEN_AFTER = 15_000;
/** Rating stays open this long after the last New Year. */
export const RATING_CLOSE_AFTER = 12 * 60 * 60_000;

/** Adding to the schedule closes this long before midnight. */
export const SCHEDULE_CLOSE_MS = 2 * 60_000;
/** A stamp older than this is not celebrated (catch-up). */
export const CATCH_UP_MAX_AGE_MS = 30 * 60_000;

/** Server clock tolerance Δ (ms). The site passes 0. */
export const SERVER_CLOCK_TOLERANCE_MS = 1500;

/** Zone poll window opens this long before the zone midnight (SPEC-07 AC-22)… */
export const POLL_WINDOW_BEFORE = 60 * MIN;
/** …and closes this long after it. */
export const POLL_WINDOW_AFTER = 60 * MIN;
