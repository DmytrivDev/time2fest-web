/**
 * Точка монтування шва в макеті (`docs/backend/frontend-seam.md`): у `sim` — «сервер» імітації (`SimRuntime`), у `http` —
 * нічого (усе робить бекенд; realtime-підключення відкривають хуки самі). В інтеграційній збірці (test + http) «сервер»
 * імітації працює лише для доменів, що лишилися на імітації (`apiDomains().sim`). Стоїть у макеті `(live)` усередині
 * `TimeProvider`, на місці колишнього `NotificationsWatcher`.
 */
import { API_MODE } from './mode';
import { SimRuntime } from '@/lib/api/simRuntimeEntry';
import { apiDomains } from './services';
import type { SimDomain } from './sim/SimRuntime';

/** Усі частини «сервера» імітації; `Record` змушує тип тримати перелік повним. */
const RUNTIME_PARTS: Record<SimDomain, true> = { notifications: true, rating: true, checkout: true, chat: true };
const ALL_PARTS = Object.keys(RUNTIME_PARTS) as SimDomain[];

/** `only` — лише частина «сервера» імітації (режим вечірки `/tv` живе без сповіщень, але рейтингу потрібен годинник). */
export function ApiRuntime({ only }: { only?: readonly SimDomain[] }) {
  if (API_MODE === 'sim') return <SimRuntime only={only} />;
  const sim = apiDomains().sim;
  const parts = (only ?? ALL_PARTS).filter((d) => sim.includes(d));
  return parts.length > 0 ? <SimRuntime only={parts} /> : null;
}
