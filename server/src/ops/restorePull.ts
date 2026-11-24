/**
 * `ops restore-pull` — серверна половина відновлення (SPEC-13b [П-7], AC-53, AC-55, AC-59), ring 3.
 *
 * Послідовність: знайти копію (`latest` = найновіший маніфест під `<prefix>backups/db/`, або явний ключ) →
 * прочитати маніфест → перевірити, що ціль порожня → завантажити ШИФРОВАНИЙ файл у власну тимчасову теку (0700)
 * під `T2F_RESTORE_TMP` → `verifyDownloaded`: розмір, sha256 і id ключа (маніфест, заголовок файла й ключ
 * середовища) — до будь-якого запуску `pg_restore` → потік «файл → `decryptStream` → stdin `pg_restore`».
 * Відкритий текст ніколи не пишеться на диск. Тимчасова тека прибирається у `finally` (і через `onTemp` —
 * командою на SIGINT / SIGTERM). Ключ і рядок підключення не потрапляють ні в результат, ні в помилки.
 *
 * Причини відмови перевірки (вихід 3): `size`, `sha256`, `key-id`, `auth` (розшифрування не пройшло автентифікацію
 * чи формат зіпсований посеред потоку — `pg_restore` тоді вбито).
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ObjectStore } from '../catalog/ports';
import { backupsPrefixOf, type BackupManifest } from './backup';
import { BACKUP_MAGIC, BackupFormatError, decryptStream, keyIdOf } from './backupFormat';

export type VerifyReason = 'size' | 'sha256' | 'key-id' | 'auth';

/** `pg_restore` of the target: rejects on a non-zero exit; an error of `input` kills the child and rejects with it. */
export interface RestoreRunner {
  restore(input: Readable): Promise<void>;
}

/** The target database: restore goes only into an empty one. */
export interface RestoreTarget {
  isEmpty(): Promise<boolean>;
}

export interface RestorePullDeps {
  /** Store of the source environment's bucket (`get`, `list`). */
  store: ObjectStore;
  /** `T2F_R2_PREFIX` of the source environment. */
  prefix: string;
  now(): number;
}

export interface RestorePullRun extends RestorePullDeps {
  /** `T2F_BACKUP_KEY`. */
  key: Buffer;
  /** `T2F_RESTORE_TMP`: the parent of this run's own temp dir. */
  tmpRoot: string;
  target: RestoreTarget;
  runner: RestoreRunner;
  /** Called with the temp dir right after it is made and with `null` once it is removed (the command's signal cleanup). */
  onTemp?(dir: string | null): void;
}

export type ManifestOutcome =
  | { result: 'ok'; manifestKey: string; manifest: BackupManifest }
  | { result: 'not-found' }
  | { result: 'bad-ref' }
  | { result: 'bad-manifest' };

export type RestorePullOutcome =
  | { result: 'ok'; manifestKey: string; manifest: BackupManifest; durationMs: number }
  | { result: 'verify-failed'; reason: VerifyReason }
  | { result: 'target-not-empty' }
  | { result: 'not-found' }
  | { result: 'bad-ref' }
  | { result: 'bad-manifest' }
  | { result: 'download-failed' }
  | { result: 'restore-failed' };

const STAMP = /^\d{8}T\d{6}Z$/;
const MANIFEST_SUFFIX = '.manifest.json';
const DUMP_SUFFIX = '.dump.enc';
const HEX64 = /^[0-9a-f]{64}$/;
const KEY_ID = /^[0-9a-f]{8}$/;
const HEADER_LEN = BACKUP_MAGIC.length + 1 + 8;

/**
 * The manifest key of `ref` under the backups prefix: `latest`, a stamp `yyyymmddThhmmssZ`, or a full dump /
 * manifest key of that prefix. Anything else → `null` (never a key outside `<prefix>backups/db/`).
 */
export function manifestKeyOf(prefix: string, ref: string): string | null {
  const base = backupsPrefixOf(prefix);
  if (STAMP.test(ref)) return `${base}${ref}${MANIFEST_SUFFIX}`;
  if (!ref.startsWith(base)) return null;
  const rest = ref.slice(base.length);
  const stamp = rest.endsWith(DUMP_SUFFIX) ? rest.slice(0, -DUMP_SUFFIX.length) : rest.endsWith(MANIFEST_SUFFIX) ? rest.slice(0, -MANIFEST_SUFFIX.length) : '';
  return STAMP.test(stamp) ? `${base}${stamp}${MANIFEST_SUFFIX}` : null;
}

/** The manifest as the backup job writes it; anything malformed or pointing outside the prefix → `null`. */
export function parseManifest(text: string, prefix: string): BackupManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const base = backupsPrefixOf(prefix);
  const ok =
    m.format === BACKUP_MAGIC &&
    typeof m.key === 'string' &&
    m.key.startsWith(base) &&
    m.key.endsWith(DUMP_SUFFIX) &&
    STAMP.test(m.key.slice(base.length, -DUMP_SUFFIX.length)) &&
    typeof m.size === 'number' &&
    Number.isInteger(m.size) &&
    m.size >= HEADER_LEN &&
    typeof m.sha256 === 'string' &&
    HEX64.test(m.sha256) &&
    typeof m.keyId === 'string' &&
    KEY_ID.test(m.keyId) &&
    typeof m.snapshotAt === 'string' &&
    typeof m.rowCounts === 'object' &&
    m.rowCounts !== null;
  return ok ? (m as unknown as BackupManifest) : null;
}

async function textOf(stream: Readable): Promise<string> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  return Buffer.concat(parts).toString('utf8');
}

/** The manifest of `ref` (`latest` = the newest manifest under the prefix). Read-only. */
export async function pullManifest(deps: RestorePullDeps, ref: string): Promise<ManifestOutcome> {
  const { store, prefix } = deps;
  if (!store.get) return { result: 'not-found' };
  let manifestKey: string | null;
  if (ref === 'latest') {
    if (!store.list) return { result: 'not-found' };
    const keys = (await store.list(backupsPrefixOf(prefix))).map((o) => o.key).filter((k) => manifestKeyOf(prefix, k) === k);
    // The stamp sorts by time, so the newest manifest is the last key.
    manifestKey = keys.sort().at(-1) ?? null;
    if (manifestKey === null) return { result: 'not-found' };
  } else {
    manifestKey = manifestKeyOf(prefix, ref);
    if (manifestKey === null) return { result: 'bad-ref' };
  }
  const body = await store.get(manifestKey);
  if (body === null) return { result: 'not-found' };
  const manifest = parseManifest(await textOf(body), prefix);
  if (manifest === null) return { result: 'bad-manifest' };
  // A manifest names its own dump: the stamps must agree.
  if (manifestKeyOf(prefix, manifest.key) !== manifestKey) return { result: 'bad-manifest' };
  return { result: 'ok', manifestKey, manifest };
}

/**
 * Checks the downloaded encrypted file against its manifest and the environment's key BEFORE any `pg_restore`
 * (AC-55): size, sha256 of the whole file, and the key id (manifest = file header = id of `key`).
 */
export async function verifyDownloaded(file: string, manifest: BackupManifest, key: Buffer): Promise<{ ok: true } | { ok: false; reason: VerifyReason }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const c of createReadStream(file)) {
    hash.update(c as Buffer);
    size += (c as Buffer).length;
  }
  if (size !== manifest.size) return { ok: false, reason: 'size' };
  if (hash.digest('hex') !== manifest.sha256) return { ok: false, reason: 'sha256' };
  const fh = await open(file, 'r');
  let header: Buffer;
  try {
    header = Buffer.alloc(HEADER_LEN);
    await fh.read(header, 0, HEADER_LEN, 0);
  } finally {
    await fh.close();
  }
  const headerId = header.subarray(BACKUP_MAGIC.length + 1).toString('ascii');
  if (headerId !== manifest.keyId || keyIdOf(key) !== manifest.keyId) return { ok: false, reason: 'key-id' };
  return { ok: true };
}

/** Streams the object into `file` (the encrypted bytes only). */
async function download(store: ObjectStore, key: string, file: string): Promise<boolean> {
  const body = await store.get!(key);
  if (body === null) return false;
  await pipeline(body, createWriteStream(file, { mode: 0o600 }));
  return true;
}

/** The full pull: manifest → empty target → download → verify → decrypt into `pg_restore`. Temp removed always. */
export async function restorePull(run: RestorePullRun, ref: string): Promise<RestorePullOutcome> {
  const started = run.now();
  const found = await pullManifest(run, ref);
  if (found.result !== 'ok') return found;
  const { manifest, manifestKey } = found;
  // The env's key must be the manifest's before anything is downloaded.
  if (keyIdOf(run.key) !== manifest.keyId) return { result: 'verify-failed', reason: 'key-id' };
  if (!(await run.target.isEmpty())) return { result: 'target-not-empty' };

  const dir = await mkdtemp(path.join(run.tmpRoot, 'restore-'));
  run.onTemp?.(dir);
  try {
    const file = path.join(dir, 'dump.enc');
    try {
      if (!(await download(run.store, manifest.key, file))) return { result: 'not-found' };
    } catch {
      return { result: 'download-failed' };
    }
    const verified = await verifyDownloaded(file, manifest, run.key);
    if (!verified.ok) return { result: 'verify-failed', reason: verified.reason };

    let formatError: BackupFormatError | undefined;
    const plain = createReadStream(file).pipe(decryptStream(run.key, manifest.keyId));
    // A decrypt error reaches the runner as an error of its input (it kills `pg_restore`); remember the code.
    const watch = new Transform({ transform: (c, _e, cb) => cb(null, c) });
    plain.on('error', (err) => {
      if (err instanceof BackupFormatError) formatError = err;
      watch.destroy(err);
    });
    plain.pipe(watch);
    try {
      await run.runner.restore(watch);
    } catch {
      plain.destroy();
      if (formatError) return { result: 'verify-failed', reason: formatError.code === 'key-mismatch' ? 'key-id' : 'auth' };
      return { result: 'restore-failed' };
    }
    return { result: 'ok', manifestKey, manifest, durationMs: Math.max(0, run.now() - started) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    run.onTemp?.(null);
  }
}
