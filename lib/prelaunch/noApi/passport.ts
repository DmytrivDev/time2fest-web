/**
 * Передстартова збірка: штампів немає. Модуль стоїть на місці `@/lib/api/hooks/passport` (`resolveAlias` у
 * `next.config.ts`) — див. `./auth.ts`.
 */
const NO_STAMPS: readonly never[] = [];

export function useStamps(): readonly never[] {
  return NO_STAMPS;
}
