/**
 * Main celebration of a country×zone pair inside one correction (AC-56 … AC-58, owner answer Q6),
 * ring 1 — pure. A different Q6 answer changes this file only.
 *
 * - marking an event main unsets the previous main of the same pair, in the same correction (AC-56);
 * - two events of one pair marked main in one correction → `invalid-input`;
 * - hiding the visible main while the pair keeps another visible event, without a new visible main in
 *   the same correction → `main-required` (AC-57);
 * - hiding it when no other visible event is left → allowed with the warning `pair-without-main`,
 *   which the save must confirm (AC-58).
 */

export const PAIR_WITHOUT_MAIN = 'pair-without-main';
export type MainWarning = typeof PAIR_WITHOUT_MAIN;

/** One event of a pair, with its effective values (base + stored correction). */
export interface PairEvent {
  eventId: string;
  isMain: boolean;
  hidden: boolean;
}

/** The effective values a correction asks for (absent = unchanged). */
export interface MainRequest {
  isMain?: boolean;
  hidden?: boolean;
}

export interface MainOutcome {
  /** Extra changes of the pair's other events: the old main loses its flag. */
  changes: Record<string, { isMainCelebration: false }>;
  warnings: MainWarning[];
}

export function applyMainRules(
  pairEvents: readonly PairEvent[],
  requested: Readonly<Record<string, MainRequest>>,
): MainOutcome | 'main-required' | 'invalid-input' {
  const chosen = pairEvents.filter((e) => requested[e.eventId]?.isMain === true);
  if (chosen.length > 1) return 'invalid-input';
  const newMain = chosen[0]?.eventId;

  const changes: MainOutcome['changes'] = {};
  const next = pairEvents.map((e) => {
    const r = requested[e.eventId] ?? {};
    let isMain = r.isMain ?? e.isMain;
    if (newMain !== undefined && e.eventId !== newMain && isMain) {
      isMain = false;
      if (r.isMain === undefined) changes[e.eventId] = { isMainCelebration: false };
    }
    return { eventId: e.eventId, isMain, hidden: r.hidden ?? e.hidden };
  });

  const warnings: MainWarning[] = [];
  const hiddenMains = pairEvents.filter((e) => e.isMain && !e.hidden && next.find((n) => n.eventId === e.eventId)?.hidden);
  const visibleMainLeft = next.some((n) => n.isMain && !n.hidden);
  if (hiddenMains.length > 0 && !visibleMainLeft) {
    if (next.some((n) => !n.hidden)) return 'main-required';
    warnings.push(PAIR_WITHOUT_MAIN);
  }
  return { changes, warnings };
}
