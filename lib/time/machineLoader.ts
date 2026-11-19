/**
 * Єдиний вхід до «машини часу» (`machineKit`) для коду, що живе й у робочій збірці (SPEC-07, AC-58, NFR-3).
 *
 * Умова — прямі `process.env.NEXT_PUBLIC_*` (як у `TimeMachineMount`): збирач підставляє літерали, бачить ранній
 * `return null` і не додає `import('./machineKit')` у граф робочої (`NEXT_PUBLIC_ENV=production`, і передстартової)
 * та репетиційної (`rehearsal`) збірок — у їхньому пакеті немає ні машини, ні її ключа сховища.
 * Умова навмисно «не production», а не «test»: у модульних тестах `NEXT_PUBLIC_ENV` не задано, а збірку вони
 * підміняють через `@/lib/env` (`IS_TEST_BUILD`) — машина там має бути доступна. У збірках `next.config` завжди задає
 * `NEXT_PUBLIC_ENV` (типово `production`). Чи діє машина, вирішують далі `IS_TEST_BUILD`/клас збірки.
 *
 * Верхньорівневий `await`: у тестовій збірці машина готова до першого рендерингу `TimeProvider` (синхронно, як і раніше).
 */
type MachineKit = typeof import('./machineKit');

async function loadMachineKit(): Promise<MachineKit | null> {
  if (process.env.NEXT_PUBLIC_ENV === 'production' || process.env.NEXT_PUBLIC_SITE_CLASS === 'rehearsal') return null;
  return import('./machineKit');
}

export const machineKit: MachineKit | null = await loadMachineKit();
