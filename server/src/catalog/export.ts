/**
 * `export catalog` (AC-82, AC-83), ring 3: the catalog in the database back to the two data files.
 * No Payload and no file system import: the source, the targets and the git check are ports.
 *
 * The export is the base only: corrections are not applied and events other than midnight do not appear
 * (the assembler leaves them out). Without `write` it prints the files that would change and writes
 * nothing; with `write` it refuses, exit 3, when a target has uncommitted changes.
 */
import type { ApiResult, CatalogPayload } from '@time2fest/contracts';
import { toData } from '../domain/catalog/toData';

export const EXPORT_FILES = ['schedule.json', 'countries.json'] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

export interface ExportPorts {
  /** The catalog document (the database or a base URL). */
  source(): Promise<ApiResult<CatalogPayload>>;
  /** The current text of a target file, or `undefined` when it does not exist. */
  readTarget(file: ExportFile): string | undefined;
  writeTarget(file: ExportFile, text: string): void;
  /** Targets with uncommitted changes (`git status --porcelain -- <targets>`); empty when clean. */
  dirtyTargets(files: readonly ExportFile[]): string[];
}

export interface ExportResult {
  /** 0 done, 1 the catalog cannot be read, 3 a target has uncommitted changes. */
  code: 0 | 1 | 3;
  lines: string[];
  changed: ExportFile[];
  written: boolean;
}

export async function exportCatalog(ports: ExportPorts, opts: { write: boolean }): Promise<ExportResult> {
  const got = await ports.source();
  if (!got.ok) {
    const reason = got.error.reason ? ` (${got.error.reason})` : '';
    return { code: 1, lines: [`export: the catalog is not available: ${got.error.code}${reason}`], changed: [], written: false };
  }
  const existing = { schedule: ports.readTarget('schedule.json'), countries: ports.readTarget('countries.json') };
  const text = toData({ schedule: got.value.schedule, countries: got.value.countries }, existing);
  const next: Record<ExportFile, string> = { 'schedule.json': text.schedule, 'countries.json': text.countries };
  const before: Record<ExportFile, string | undefined> = { 'schedule.json': existing.schedule, 'countries.json': existing.countries };
  const changed = EXPORT_FILES.filter((f) => before[f] !== next[f]);

  if (!opts.write) {
    const lines =
      changed.length === 0
        ? ['export: no file would change']
        : ['export: would change (nothing written; add --write):', ...changed.map((f) => `  ${f}`)];
    return { code: 0, lines, changed: [...changed], written: false };
  }
  const dirty = ports.dirtyTargets(changed);
  if (dirty.length > 0) {
    return {
      code: 3,
      lines: ['export: refused, uncommitted changes in the target files:', ...dirty.map((f) => `  ${f}`)],
      changed: [...changed],
      written: false,
    };
  }
  for (const f of changed) ports.writeTarget(f, next[f]);
  return {
    code: 0,
    lines: changed.length === 0 ? ['export: no file changed'] : ['export: written:', ...changed.map((f) => `  ${f}`)],
    changed: [...changed],
    written: true,
  };
}
