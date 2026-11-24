/**
 * Виконавець зберігання копій (SPEC-13b AC-46), ring 3: перелік ЛИШЕ під `<T2F_R2_PREFIX>backups/db/`, план
 * `retentionPlan` (точний шаблон імен, лише пари, найновіша ціла), видалення пари (спершу маніфест, далі дамп —
 * перервана пара лишається сиротою без маніфесту, яку наступний прохід не вважає копією) і рядок журналу
 * `ops.backup-deleted` на кожну видалену пару. Нічого поза префіксом копій не видаляється.
 */
import type { ObjectStore } from '../catalog/ports';
import { retentionPlan } from '../domain/ops/retention';
import type { OpsJournal } from './ports';

export const BACKUP_DELETED_ACTION = 'ops.backup-deleted';

export interface RetentionDeps {
  store: Pick<ObjectStore, 'delete' | 'list'>;
  /** `<T2F_R2_PREFIX>backups/db/`. */
  backupsPrefix: string;
  journal: OpsJournal;
}

/** Один прохід зберігання; повертає кількість видалених пар. Кидає, якщо перелік чи видалення не вдалися. */
export async function runRetention(deps: RetentionDeps, now: number): Promise<{ deleted: number }> {
  const { store, backupsPrefix } = deps;
  if (!store.list || !store.delete) throw new Error('retention: store cannot list or delete');
  if (!/backups\/db\/$/.test(backupsPrefix)) throw new Error('retention: not a backups prefix');
  const listed = await store.list(backupsPrefix);
  const doomed = retentionPlan(
    listed.map((o) => o.key),
    backupsPrefix,
    now,
  );
  let deleted = 0;
  for (const pair of doomed) {
    // Подвійна перевірка перед видаленням: ключ — точно під префіксом копій.
    if (!pair.manifestKey.startsWith(backupsPrefix) || !pair.dumpKey.startsWith(backupsPrefix)) continue;
    await store.delete(pair.manifestKey);
    await store.delete(pair.dumpKey);
    deleted += 1;
    await deps.journal.line(BACKUP_DELETED_ACTION, pair.dumpKey, { stamp: pair.stamp, kind: pair.kind }, now);
  }
  return { deleted };
}
