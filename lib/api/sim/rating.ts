/**
 * Адаптер `sim` домену «Рейтинг»: «сервер» оцінок у вкладці. Голоси людини — `guest.rate[*].stars` (адаптер лише
 * делегує `setRate`), «оцінки світу» — імітація `worldVotes`; агрегати (середня, зважена, місце) рахуємо тут, бо в
 * `http` їх рахує сервер. Чиста формула (`weighted`) і складання рядів — у `lib/rating/rating.ts`.
 *
 * Агрегати залежать від часу сайту (святкування відкривається через 15 с після півночі, оцінок світу більшає перші
 * 3 год) — час дає `RatingTicker` із `SimRuntime` через `setSimRatingNow`; кожен виклик розсилає знімок підписникам.
 */
import { ok } from '../result';
import type { RatingAggregate, RatingBoard, RatingService } from '../contracts/rating';
import { getData } from '@/lib/data/load';
import type { Dataset, Ms, Stars } from '@/lib/data/types';
import { isRateable } from '@/lib/passport/passport';
import { buildRatingState, ratingCloseAt, RATING_OPEN_AFTER, weighted, type RatingAggregates, type RatingState } from '@/lib/rating/rating';
import { useGuestStore } from '@/stores/guest';

const GROW: Ms = 3 * 60 * 60_000;

/** Стабільне псевдовипадкове число 0–1 з рядка (імітатор). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/**
 * Імітовані «оцінки світу» події на момент `now`: стала середня й кількість за популярністю, кількість росте перші 3 год
 * після півночі.
 */
export function worldVotes(eventId: string, popularity: number, midnightMs: Ms, now: Ms): { mean: number; votes: number } {
  const r = hash01(eventId);
  const mean = Math.round((3.9 + r * 0.9 + (popularity - 60) / 200) * 100) / 100;
  const full = Math.round(popularity * popularity * (1.2 + r * 1.6));
  const share = Math.min(1, Math.max(0, (now - midnightMs) / GROW));
  return { mean: Math.min(5, Math.max(1, mean)), votes: Math.round(full * share) };
}

/** Оцінки людини з пристрою (`guest.rate`) → `eventId → зірки`. */
export function minesOf(rate: Readonly<Record<string, { stars?: Stars } | undefined>>): Record<string, Stars> {
  const out: Record<string, Stars> = {};
  for (const [id, r] of Object.entries(rate)) if (r?.stars !== undefined) out[id] = r.stars;
  return out;
}

/** Що порахував би сервер: відкриті святкування з оцінками світу + оцінка людини, зважена оцінка й місце. */
export function simAggregates(data: Dataset, now: Ms, mine: Readonly<Record<string, Stars>>): RatingAggregates {
  const open = data.events.filter((e) => isRateable(data, e.id) && now >= e.midnightMs + RATING_OPEN_AFTER);
  const base = open.map((e) => {
    const w = worldVotes(e.id, e.popularity, e.midnightMs, now);
    const own = mine[e.id];
    const votes = w.votes + (own ? 1 : 0);
    const mean = votes ? (w.mean * w.votes + (own ?? 0)) / votes : w.mean;
    return { eventId: e.id, mean, votes };
  });
  const globalMean = base.length ? base.reduce((n, r) => n + r.mean, 0) / base.length : 4.3;
  const rows: RatingAggregate[] = base
    .map((r) => ({ ...r, score: weighted(r.mean, r.votes, globalMean), place: 0 }))
    .sort((a, b) => b.score - a.score || b.votes - a.votes)
    .map((r, i) => ({ ...r, place: i + 1 }));
  return { rows, totalVotes: rows.reduce((n, r) => n + r.votes, 0), mine };
}

/** Повний стан рейтингу на момент `now` для імітації (чат-імітатор «новий лідер», тести) — те саме, що дає хук. */
export function ratingState(data: Dataset, now: Ms, mine: Readonly<Record<string, { stars?: Stars } | undefined>>): RatingState {
  return buildRatingState(data, now, simAggregates(data, now, minesOf(mine)));
}

type Listener = () => void;
let simNow: Ms = 0;
const tickListeners = new Set<Listener>();

/** Час сайту для імітації (з `RatingTicker`); розсилає свіжий знімок підписникам. */
export function setSimRatingNow(now: Ms): void {
  simNow = now;
  tickListeners.forEach((l) => l());
}

function boardNow(): RatingBoard {
  const data = getData();
  const mine = minesOf(useGuestStore.getState().rate);
  const agg = simAggregates(data, simNow, mine);
  const closeAt = ratingCloseAt(data);
  return { rows: agg.rows, totalVotes: agg.totalVotes, closeAt, closed: simNow >= closeAt, mine };
}

export function createSimRating(): RatingService {
  return {
    async board() {
      return ok(boardNow());
    },
    subscribe(onUpdate) {
      const emit = () => {
        const b = boardNow();
        onUpdate(b.rows, b.totalVotes, b.mine);
      };
      tickListeners.add(emit);
      // Оцінки на пристрої змінює не лише адаптер (скидання гостя, тестові засоби) — стежимо за стором.
      const off = useGuestStore.subscribe((state, prev) => {
        if (state.rate !== prev.rate) emit();
      });
      return () => {
        tickListeners.delete(emit);
        off();
      };
    },
    async vote(eventId, stars) {
      useGuestStore.getState().setRate(eventId, { stars });
      return ok({ eventId, stars });
    },
  };
}
