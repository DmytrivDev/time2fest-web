export type TimeStatus = 'server' | 'device-fallback' | 'machine';

/**
 * Спільний інтерфейс джерела часу: справжній `TimeSource` (сервер) або «машина часу».
 * Усе на сайті читає час лише через нього (принцип II).
 */
export interface TimeSourceLike {
  /** Поточний час у мс epoch UTC. */
  now(): number;
  readonly status: TimeStatus;
  /** `true`, коли перша синхронізація завершилась (успіхом або резервом). */
  readonly ready: boolean;
  /** Множник швидкості: 1 для сервера; 0…600 для «машини часу». */
  readonly speed: number;
  /** Повідомлення про стрибок/зміну якоря чи статусу. Повертає відписку. */
  subscribe(listener: () => void): () => void;
  start?(): void;
  stop?(): void;
}
