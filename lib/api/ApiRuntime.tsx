/**
 * Точка монтування шва в макеті (`docs/backend/frontend-seam.md`): у `sim` — «сервер» імітації (`SimRuntime`), у `http` —
 * нічого (усе робить бекенд; realtime-підключення відкривають хуки самі). Стоїть у макеті `(live)` усередині
 * `TimeProvider`, на місці колишнього `NotificationsWatcher`.
 */
import { API_MODE } from './mode';
import { SimRuntime, type SimDomain } from './sim/SimRuntime';

/** `only` — лише частина «сервера» імітації (режим вечірки `/tv` живе без сповіщень, але рейтингу потрібен годинник). */
export function ApiRuntime({ only }: { only?: readonly SimDomain[] }) {
  return API_MODE === 'sim' ? <SimRuntime only={only} /> : null;
}
