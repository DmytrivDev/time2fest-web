/**
 * The presence window of an event moment (SPEC-14 [А1], [А9], AC-4, AC-10, AC-11, AC-17, AC-32), ring 1, pure.
 * Membership is decided ONLY by `isPresentByPulses` of `@time2fest/rules/time` with I = `PULSE_INTERVAL_MS` and
 * Δ = `SERVER_CLOCK_TOLERANCE_MS`; only the server's receipt time is passed, so a client `openedAt`/`at` can never
 * widen the window (AC-11). The window bounds are derived from that rule (the end is `stampAcceptUntil`, the start is
 * found by bisection over the rule), never re-declared.
 */
import { celebrationEndAt, isPresentByPulses, PULSE_INTERVAL_MS, SERVER_CLOCK_TOLERANCE_MS, stampAcceptUntil } from '@time2fest/rules/time';

/** Δ of every presence decision on the server. */
export const PRESENCE_DELTA_MS = SERVER_CLOCK_TOLERANCE_MS;
/** The "before the window" span of the intake counters (AC-17): subjects beating this long before the moment. */
export const PRE_WINDOW_LEAD_MS = 300_000;
/** How far back the bisection looks for the window start (the rule's window is far shorter). */
const SEARCH_SPAN_MS = 3_600_000;

export interface PresenceWindow {
  /** The event moment (its effective midnight). */
  readonly moment: number;
  /** First instant inside the window (inclusive). */
  readonly from: number;
  /** Last instant inside the window (inclusive). */
  readonly until: number;
}

/** Whether a beat received (server clock) at `receivedAt` lies in the window of `moment`. */
export function inWindow(receivedAt: number, moment: number): boolean {
  return isPresentByPulses({ moment, pulses: [{ receivedAt }], intervalMs: PULSE_INTERVAL_MS, delta: PRESENCE_DELTA_MS });
}

/** Offset of the window start before the moment, derived once from the rule (it does not depend on the moment). */
const START_OFFSET_MS: number = (() => {
  // The rule is a closed interval: everything below its start is out, the start itself is in.
  let lo = -SEARCH_SPAN_MS; // out
  let hi = 0; // in (the moment itself)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (inWindow(mid, 0)) hi = mid;
    else lo = mid;
  }
  return -hi;
})();

/** The window of `moment`: `[from; until]`, both inclusive. */
export function windowOf(moment: number): PresenceWindow {
  return { moment, from: moment - START_OFFSET_MS, until: stampAcceptUntil(moment, PRESENCE_DELTA_MS) };
}

/** Which intake counter a beat feeds for `moment`: `in` inside the window, `pre` in `[m − 5 min; window start)`. */
export function phaseOf(receivedAt: number, moment: number): 'pre' | 'in' | null {
  if (inWindow(receivedAt, moment)) return 'in';
  const w = windowOf(moment);
  const lead = moment - receivedAt;
  return receivedAt < w.from && lead <= PRE_WINDOW_LEAD_MS ? 'pre' : null;
}

/** Zone midnights of the season (the celebration span), as the rules' `ZonesLike`. */
export interface SeasonZones {
  readonly zones: readonly { readonly midnightMs: number }[];
}

/**
 * True once the SEASON celebration (last midnight + `CELEBRATION_TAIL` + Δ, `celebrationEndAt` of the rules) is over.
 * Season-level cutoff on purpose (conductor decision, traced in the spec [А9]); no zones → never "over" here, so a
 * missing catalog never drops an accepted old moment.
 */
export function celebrationOver(now: number, zones: SeasonZones): boolean {
  if (zones.zones.length === 0) return false;
  return now > celebrationEndAt({ zones: [...zones.zones] }, PRESENCE_DELTA_MS);
}

/**
 * Moments of an event that still accept presence at `now` [А9], [П-4]: the current moment always; every other moment
 * the server has seen for the event until the celebration is over. Sorted, distinct.
 */
export function acceptedMomentsOf(current: number, seen: readonly number[], now: number, zones: SeasonZones): number[] {
  const out = new Set<number>([current]);
  if (!celebrationOver(now, zones)) for (const m of seen) if (Number.isFinite(m)) out.add(m);
  return [...out].sort((a, b) => a - b);
}

/** The moments among `moments` whose window contains `receivedAt`. */
export function windowsContaining(receivedAt: number, moments: readonly number[]): number[] {
  return moments.filter((m) => inWindow(receivedAt, m));
}
