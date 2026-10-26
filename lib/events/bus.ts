/**
 * Типізована шина подій UI (`contracts/ui-events.md`): `on(type, handler) → unsubscribe`,
 * `emit(type, payload)`. Обробники синхронні, порядок підписки зберігається;
 * помилка одного обробника не зупиняє інших.
 */
import type { UiEventHandler, UiEventMap, UiEventType } from './types';

export type { UiEventMap, UiEventType } from './types';

const handlers = new Map<UiEventType, UiEventHandler<UiEventType>[]>();

export function on<K extends UiEventType>(type: K, handler: UiEventHandler<K>): () => void {
  const list = handlers.get(type) ?? [];
  list.push(handler as UiEventHandler<UiEventType>);
  handlers.set(type, list);
  return () => {
    const cur = handlers.get(type);
    if (!cur) return;
    const i = cur.indexOf(handler as UiEventHandler<UiEventType>);
    if (i !== -1) cur.splice(i, 1);
  };
}

export function emit<K extends UiEventType>(type: K, payload: UiEventMap[K]): void {
  const list = handlers.get(type);
  if (!list?.length) return;
  for (const h of [...list]) {
    try {
      (h as UiEventHandler<K>)(payload);
    } catch (err) {
      console.error(`[events] обробник ${type} упав`, err);
    }
  }
}

/** Для тестів: прибрати всі підписки. */
export function clearAllHandlers(): void {
  handlers.clear();
}
