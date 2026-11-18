/**
 * Передстартова збірка: бекенду немає, входу немає. Цей модуль стоїть на місці `@/lib/api/hooks/auth`
 * (`resolveAlias` у `next.config.ts`), щоб спільні блоки (вікно країни на мапі) не зверталися до шва даних:
 * профілю немає, «мій графік» порожній.
 */
const NO_SCHEDULE: readonly string[] = [];

export function useProfile(): null {
  return null;
}

export function useSchedule(): readonly string[] {
  return NO_SCHEDULE;
}
