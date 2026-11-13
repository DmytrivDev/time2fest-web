/**
 * Точка монтування шва в макеті (`docs/backend/frontend-seam.md`): у `sim` — «сервер» імітації (`SimRuntime`), у `http` —
 * нічого (усе робить бекенд; realtime-підключення відкривають хуки самі). Стоїть у макеті `(live)` усередині
 * `TimeProvider`, на місці колишнього `NotificationsWatcher`.
 */
import { API_MODE } from './mode';
import { SimRuntime } from './sim/SimRuntime';

export function ApiRuntime() {
  return API_MODE === 'sim' ? <SimRuntime /> : null;
}
