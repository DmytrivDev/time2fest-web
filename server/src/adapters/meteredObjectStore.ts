/**
 * Обгортка `ObjectStore` з обліком операцій R2 (SPEC-13b AC-39, [П-9]), ring 4 — декоратор без власної логіки
 * сховища: кожен виклик іде у внутрішнє сховище без змін, лічильник лише записує клас, префікс і результат.
 *
 * `putMultipart`: тіло проходить через лічильник байтів. Успіх — тіло ≤ частини → один `PutObject` (A 1),
 * інакше створення + `⌈розмір / частина⌉` частин + завершення. Невдача — оцінка за прочитаними байтами
 * (нижня межа). Відсутні у внутрішнього сховища методи відсутні й в обгортці.
 */
import { Transform, pipeline, type Readable } from 'node:stream';
import type { ObjectStore } from '../catalog/ports';
import type { R2Meter, R2Prefix } from '../ops/meter';
import type { WallClock } from '../ops/ports';
import { MULTIPART_PART_BYTES } from './s3';

export function createMeteredObjectStore(
  inner: ObjectStore,
  meter: R2Meter,
  prefixOf: (key: string) => R2Prefix,
  clock: WallClock,
): ObjectStore {
  const timed = async <T>(key: string, classA: number, classB: number, run: () => Promise<T>): Promise<T> => {
    try {
      const out = await run();
      meter.record({ prefix: prefixOf(key), classA, classB, ok: true, at: clock.now() });
      return out;
    } catch (err) {
      meter.record({ prefix: prefixOf(key), classA, classB, ok: false, at: clock.now() });
      throw err;
    }
  };

  const store: ObjectStore = {
    put: (key, body, contentType) => timed(key, 1, 0, () => inner.put(key, body, contentType)),
  };
  const { delete: del, get, head, list, putMultipart } = inner;
  if (del) store.delete = (key) => timed(key, 1, 0, () => del.call(inner, key));
  if (get) store.get = (key) => timed(key, 0, 1, () => get.call(inner, key));
  if (head) store.head = (key) => timed(key, 0, 1, () => head.call(inner, key));
  if (list) store.list = (prefix) => timed(prefix, 1, 0, () => list.call(inner, prefix));
  if (putMultipart) {
    store.putMultipart = async (key, body, contentType, partBytes) => {
      const part = partBytes > 0 ? partBytes : MULTIPART_PART_BYTES;
      let seen = 0;
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          seen += chunk.length;
          cb(null, chunk);
        },
      });
      // Помилка джерела руйнує `tap`, і внутрішнє сховище бачить її як помилку тіла.
      pipeline(body as Readable, tap, () => undefined);
      try {
        const out = await putMultipart.call(inner, key, tap, contentType, part);
        meter.record({ prefix: prefixOf(key), classA: opsFor(out.size, part, true), classB: 0, ok: true, at: clock.now() });
        return out;
      } catch (err) {
        meter.record({ prefix: prefixOf(key), classA: opsFor(seen, part, false), classB: 0, ok: false, at: clock.now() });
        throw err;
      }
    };
  }
  return store;
}

/** Операції класу A одного `putMultipart` за розміром тіла. */
function opsFor(bytes: number, part: number, completed: boolean): number {
  if (bytes <= part) return 1;
  const parts = completed ? Math.ceil(bytes / part) : Math.max(1, Math.floor(bytes / part));
  return 1 + parts + (completed ? 1 : 0);
}
