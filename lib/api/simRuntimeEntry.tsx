/**
 * Вхід `ApiRuntime` у «сервер» імітації (`SimRuntime`). У збірці `http` підміняється на
 * `lib/api/http/simRuntimeEntry.disabled.tsx` (`next.config.ts`).
 */
export { SimRuntime } from './sim/SimRuntime';
