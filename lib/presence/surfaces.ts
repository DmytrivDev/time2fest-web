/**
 * Реєстр відкритих поверхонь присутності (T070, FR-060, `contracts/ui-events.md` — `moment:stamp`) — клієнтський,
 * однаковий для `sim` і `http` (шов E5b, `docs/backend/frontend-seam.md`).
 *
 * - Сторінка, що показує подію (ефір, країна, кімната, ТВ), реєструє поверхню через сервіс паспорта
 *   (`usePresence` → `trackPresence`); тут лише реєстр.
 * - `surfacePresence(eventIds, at)` — для `EngineScheduler.getPresence`: реєстр + `guest.pendingPresence` (присутність,
 *   записана на пристрої), тож момент штампа настає навіть тоді, коли такт перескочив через північ (машина часу, сон вкладки).
 * - Штамп видає не сторінка, а сервіс (`lib/api/sim/passport` у `sim`).
 */
import type { Ms, PresenceSource } from '@/lib/data/types';
import { getData } from '@/lib/data/load';
import { type PresenceSurface, presentEvents } from '@time2fest/rules/time';
import { useGuestStore } from '@/stores/guest';

/** Відкриті поверхні сторінок (одна вкладка = один реєстр). */
const registry = new Map<number, PresenceSurface>();
let seq = 0;

/** Для тестів: очистити реєстр. */
export function clearPresenceRegistry(): void {
  registry.clear();
}

export function registerSurface(surface: PresenceSurface): () => void {
  const id = ++seq;
  registry.set(id, surface);
  return () => {
    registry.delete(id);
  };
}

/** Присутність за подіями в момент `at`: відкриті поверхні + уже зафіксоване в стані гостя. */
export function surfacePresence(eventIds: readonly string[], at: Ms): Record<string, PresenceSource> {
  const data = getData();
  const events = eventIds.map((id) => data.eventsById.get(id)).filter((e) => e !== undefined);
  const live = presentEvents([...registry.values()], events, at);
  const pending = useGuestStore.getState().pendingPresence;
  const out: Record<string, PresenceSource> = {};
  for (const id of eventIds) {
    const p = pending[id];
    if (p && p.at <= at) out[id] = p.source;
    else if (live[id]) out[id] = live[id];
  }
  return out;
}
