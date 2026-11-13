/**
 * Головне святкування поясу (рішення власника 2026-11-13, `docs/decision.md`). Чисті функції, «зараз» — аргументом.
 *
 * - Головне святкування події — її джерело `kind: 'main'`. Поки воно не почалось, на місці відео заглушка «Трансляція
 *   очікується»; час і відлік — лише коли початок відомий з даних і ще попереду (`knownStart`). Відео вмикається саме,
 *   щойно дані кажуть «наживо».
 * - На заглушці кнопка «Дивитися, що вже йде», якщо в поясі (та сама північ) зараз щось іде наживо (`zoneHasLive`).
 * - «Зараз і далі»: картка головного святкування — зі статусом самого головного джерела (`mainCardStream`).
 * - Рядок «Головне святкування почалось · Перемкнути» (`mainLiveLine`): людина сама обрала іншу трансляцію цього поясу,
 *   а головне вже йде. Без жодного автоматичного перемикання.
 */
import type { Dataset, Ms, StreamChain, StreamSource } from '@/lib/data/types';
import { sourceStatus } from './sourceStatus';

/** Головне святкування в ланцюжку події (`kind: 'main'`); немає — `null`. */
export function mainSourceOf(chain: StreamChain | undefined | null): StreamSource | null {
  return chain?.sources.find((s) => s.kind === 'main') ?? null;
}

/** Початок, якщо він відомий і ще попереду; невідомий чи вже минув — `null` (тоді ні часу, ні відліку). */
export function knownStart(src: Pick<StreamSource, 'startsAt'> | { startsAt?: string | number }, now: Ms): Ms | null {
  const raw = src.startsAt;
  if (raw === undefined) return null;
  const at = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(at) && at > now ? at : null;
}

/** Головне джерело йде (за даними): «наживо» чи «можливо», як у вибору джерела плеєра. */
export function isMainLive(src: StreamSource, now: Ms): boolean {
  const st = sourceStatus(src, now);
  return st === 'live' || st === 'possible';
}

/** Чи йде зараз наживо хоч одна трансляція поясу (подій з тією самою північчю). */
export function zoneHasLive(data: Pick<Dataset, 'events' | 'chainsByEventId'>, midnightMs: Ms, now: Ms): boolean {
  return data.events.some(
    (e) => e.midnightMs === midnightMs && (data.chainsByEventId.get(e.id)?.sources ?? []).some((s) => sourceStatus(s, now) === 'live'),
  );
}

/**
 * Статус картки головного святкування в «Зараз і далі»: за самим головним джерелом, а не за найкращим у ланцюжку
 * (вебкамери того самого міста не роблять головне «наживо»). Ще не почалось (`none` теж) — «очікується».
 */
export function mainCardStream(main: StreamSource, now: Ms): 'live' | 'expected' | 'possible' {
  const st = sourceStatus(main, now);
  return st === 'live' || st === 'possible' ? st : 'expected';
}

export interface MainLiveLineInput {
  now: Ms;
  /** Подія з головним святкуванням (ефір головної / головна подія поясу на сторінці країни) і її головне джерело. */
  main: { eventId: string; source: StreamSource } | null;
  /** Північ цієї події. */
  midnightMs: Ms;
  /** Що грає в плеєрі зараз. */
  playing: { eventId: string; sourceId: string; midnightMs: Ms } | null;
  /** Людина сама обрала трансляцію (а не плеєр відступив на запасне джерело). */
  manual: boolean;
  /** В останні 60 с до півночі той самий рядок займає підказка про штамп. */
  stampHint: boolean;
  /** Передача ефіру наступному поясу (північ + 15 хв). */
  handoverAt: Ms;
}

/**
 * «Головне святкування почалось · Перемкнути»: людина сама обрала іншу трансляцію ЦЬОГО поясу, а головне вже йде.
 * Ховається, щойно грає головне, коли рядок займає підказка про штамп і після передачі ефіру.
 */
export function mainLiveLine(i: MainLiveLineInput): boolean {
  if (!i.manual || !i.main || !i.playing || i.stampHint || i.now >= i.handoverAt) return false;
  if (i.playing.sourceId === i.main.source.id) return false;
  if (i.playing.midnightMs !== i.midnightMs) return false;
  return isMainLive(i.main.source, i.now);
}
