/**
 * Вибір джерела часу сайту й параметри адреси «машини часу» (`contracts/time-machine.md`).
 * У робочій збірці `t`, `speed`, `panel` ігноруються: самої машини (`machineKit`) у пакеті немає — `machineLoader`
 * відсікає її константами збірки (SPEC-07, AC-58), а `createAppTimeSource` повертає серверний `TimeSource`.
 */
import { IS_TEST_BUILD } from '@/lib/env';
import { machineKit } from './machineLoader';
import { startRehearsalClock } from './rehearsalClock';
import { TimeSource } from './TimeSource';
import type { MachineLike, TimeSourceLike } from './types';
import type { MachineStart } from './machineKit';

export {
  parseIsoWithOffset,
  parseMachineParams,
  safeLocalStorage,
  safeSessionStorage,
  writeMachineToUrl,
  type MachineParams,
} from './machineParams';

export interface AppTimeSource {
  source: TimeSourceLike;
  machine: MachineLike | null;
  start: MachineStart | null;
  /** Підключити збереження/адресу (для машини) і запустити синхронізацію (для сервера). */
  activate(): () => void;
}

/** Джерело часу для сайту: у тестовій збірці — машина часу, інакше — серверний `TimeSource`. */
export function createAppTimeSource(): AppTimeSource {
  // Класи збірки читаються з `process.env` напряму: збирач підставляє літерали й відсікає гілки (AC-58, NFR-3),
  // а наявні тести підміняють `@/lib/env` лише двома константами. Репетиція (test + http, `rehearsal`) — без машини.
  const machineBuild = IS_TEST_BUILD && process.env.NEXT_PUBLIC_SITE_CLASS !== 'rehearsal';
  if (machineBuild && machineKit && typeof window !== 'undefined') {
    const app = machineKit.createMachineSource(window);
    if (app) return app;
  }
  const source = new TimeSource();
  return {
    source,
    machine: null,
    start: null,
    activate: () => {
      source.start();
      // Репетиція: подія `clock` каналу `site:state` → негайна пересинхронізація (SPEC-07, AC-57); у інших збірках гілку відсікає збирач.
      const stopClock =
        process.env.NEXT_PUBLIC_SITE_CLASS === 'rehearsal' ? startRehearsalClock(source) : null;
      return () => {
        stopClock?.();
        source.stop();
      };
    },
  };
}
