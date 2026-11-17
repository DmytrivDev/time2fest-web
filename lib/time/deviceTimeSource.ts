import type { TimeSourceLike } from './types';

/**
 * Годинник пристрою без синхронізації й «машини часу»: для сторінок «до свята» (`/before`), де час — за годинником
 * відвідувача навіть у демо-збірці (там головна живе на віртуальній ночі свята).
 */
export function createDeviceTimeSource(): TimeSourceLike {
  return {
    now: () => Date.now(),
    status: 'device-fallback',
    ready: true,
    speed: 1,
    subscribe: () => () => undefined,
  };
}
