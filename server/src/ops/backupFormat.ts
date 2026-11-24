/**
 * Формат шифрованої копії `T2FB1` (SPEC-13b AC-41, AC-55, [А15]), ring 3 — потоки `node:crypto`, без залежностей.
 *
 * Заголовок (30 байтів): магія `T2FB1` (5 ASCII) + байт версії `0x02` + id ключа (8 ASCII hex = перші 8 hex
 * sha256 ключа) + id файлу (16 випадкових байтів). Далі частини: `[довжина відкритого тексту u32 BE][nonce 12]
 * [шифротекст][тег 16]`, відкритого тексту ≤64 КіБ, nonce випадковий на кожну частину,
 * AAD = `заголовок (30 байтів) || u64 BE номер частини || u8 остання (0|1)`.
 * Номер у AAD ловить перестановку й пропуск, прапор «остання» — обрізання по межі частини; після останньої
 * частини даних бути не може. Остання частина буває порожньою (порожній вхід). Заголовок у AAD (безпека S-4)
 * привʼязує кожну частину до свого файлу: частини двох копій одним ключем не склеїш, а підмінений байт версії,
 * id ключа чи id файлу ламає тег першої ж частини. Версію `0x01` (AAD без заголовка) відкинуто — справжніх
 * копій у ній не було.
 *
 * Розшифрування віддає відкритий текст частини лише після перевірки її тега. Помилки — `BackupFormatError` з
 * кодом; ні ключ, ні відкритий текст у повідомлення не потрапляють. Ключ ніколи не логуюється.
 *
 * Межа потокового розшифрування (безпека S-5, свідомо): `decryptStream` віддає кожну автентифіковану частину
 * одразу, тож споживач (`pg_restore` у `ops restore-pull`) може застосувати частину копії ще до того, як
 * автентифіковано кінець файлу (обрізання чи підміна хвоста виявиться лише як `truncated`/`auth-failed`
 * наприкінці). Тому `restorePull` спершу звіряє sha256 усього завантаженого файлу з маніфестом і лише потім
 * розшифровує, а ціль — одноразовий стек `t2f-restore-*`, який після збою видаляють.
 *
 * Nonce випадкові 96-бітні: при ≤2^32 частинах на ключ (≈256 ТіБ) ймовірність збігу в межах настанови NIST.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

export const BACKUP_MAGIC = 'T2FB1';
export const BACKUP_FORMAT_VERSION = 2;
/** Найбільша частина відкритого тексту. */
export const BACKUP_CHUNK_BYTES = 64 * 1024;

const MAGIC = Buffer.from(BACKUP_MAGIC, 'ascii');
const KEY_ID_LEN = 8;
const FILE_ID_BYTES = 16;
const HEADER_LEN = MAGIC.length + 1 + KEY_ID_LEN + FILE_ID_BYTES;
/** Довжина заголовка файлу (магія + версія + id ключа + id файлу). */
export const BACKUP_HEADER_BYTES = HEADER_LEN;

/** Id ключа із заголовка файлу (без перевірок; перевіряє `decryptStream`). */
export function headerKeyIdOf(header: Buffer): string {
  return header.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_LEN).toString('ascii');
}
const LEN_BYTES = 4;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type BackupFormatErrorCode = 'bad-header' | 'key-mismatch' | 'auth-failed' | 'truncated' | 'trailing-data' | 'bad-key';

/** Помилка формату копії: лише код і безпечне повідомлення. */
export class BackupFormatError extends Error {
  readonly code: BackupFormatErrorCode;
  constructor(code: BackupFormatErrorCode, message: string) {
    super(message);
    this.name = 'BackupFormatError';
    this.code = code;
  }
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new BackupFormatError('bad-key', 'backup key: must be 32 bytes');
}

/** Id ключа: перші 8 hex sha256 ключа (не дозволяє відновити ключ). */
export function keyIdOf(key: Buffer): string {
  assertKey(key);
  return createHash('sha256').update(key).digest('hex').slice(0, KEY_ID_LEN);
}

/**
 * Ключ із `T2F_BACKUP_KEY` (base64, рівно 32 байти). Кидає з назвою змінної, ніколи зі значенням.
 */
export function parseBackupKey(base64: string): Buffer {
  const trimmed = base64.trim();
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) ? Buffer.from(trimmed, 'base64') : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) throw new BackupFormatError('bad-key', 'T2F_BACKUP_KEY: must be 32 bytes of base64');
  return key;
}

/** AAD частини: увесь заголовок файлу (магія, версія, id ключа, id файлу) + номер + прапор «остання». */
function aadOf(header: Buffer, index: number, last: boolean): Buffer {
  const aad = Buffer.alloc(header.length + 9);
  header.copy(aad, 0);
  aad.writeBigUInt64BE(BigInt(index), header.length);
  aad.writeUInt8(last ? 1 : 0, header.length + 8);
  return aad;
}

function headerOf(keyId: string, fileId: Buffer): Buffer {
  return Buffer.concat([MAGIC, Buffer.from([BACKUP_FORMAT_VERSION]), Buffer.from(keyId, 'ascii'), fileId]);
}

/** Потік «відкритий текст → `T2FB1`». `keyId` — id цього ключа (`keyIdOf`), записується в заголовок. */
export function encryptStream(key: Buffer, keyId: string): Transform {
  assertKey(key);
  if (keyId !== keyIdOf(key)) throw new BackupFormatError('key-mismatch', 'backup key id does not match the key');
  const fileHeader = headerOf(keyId, randomBytes(FILE_ID_BYTES));
  let pending: Buffer = Buffer.alloc(0);
  let index = 0;
  let headerSent = false;

  const seal = (plain: Buffer, last: boolean): Buffer => {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aadOf(fileHeader, index, last));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const len = Buffer.alloc(LEN_BYTES);
    len.writeUInt32BE(plain.length, 0);
    index += 1;
    return Buffer.concat([len, nonce, body, cipher.getAuthTag()]);
  };

  const header = (t: Transform): void => {
    if (headerSent) return;
    headerSent = true;
    t.push(fileHeader);
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        header(this);
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
        // Тримаємо хвіст: частина повна і після неї ще є дані → вона точно не остання.
        let offset = 0;
        while (pending.length - offset > BACKUP_CHUNK_BYTES) {
          this.push(seal(pending.subarray(offset, offset + BACKUP_CHUNK_BYTES), false));
          offset += BACKUP_CHUNK_BYTES;
        }
        if (offset > 0) pending = Buffer.from(pending.subarray(offset));
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        header(this);
        this.push(seal(pending, true));
        pending = Buffer.alloc(0);
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
}

/**
 * Потік «`T2FB1` → відкритий текст». `expectedKeyId` — id ключа з маніфесту: інший id у заголовку чи інший
 * ключ → `key-mismatch` до першої частини (AC-55).
 */
export function decryptStream(key: Buffer, expectedKeyId: string): Transform {
  assertKey(key);
  const ownId = keyIdOf(key);
  let pending: Buffer = Buffer.alloc(0);
  let fileHeader: Buffer = Buffer.alloc(0);
  let headerDone = false;
  let index = 0;
  let sawLast = false;

  const parse = (t: Transform): void => {
    if (!headerDone) {
      if (pending.length < HEADER_LEN) {
        // Рання відмова на чужій магії, щойно її видно.
        const n = Math.min(pending.length, MAGIC.length);
        if (!pending.subarray(0, n).equals(MAGIC.subarray(0, n))) throw new BackupFormatError('bad-header', 'backup: not a T2FB1 file');
        return;
      }
      if (!pending.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupFormatError('bad-header', 'backup: not a T2FB1 file');
      if (pending.length >= MAGIC.length + 1 && pending[MAGIC.length] !== BACKUP_FORMAT_VERSION) {
        throw new BackupFormatError('bad-header', 'backup: unknown format version');
      }
      const id = pending.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_LEN).toString('ascii');
      if (id !== expectedKeyId || id !== ownId) throw new BackupFormatError('key-mismatch', 'backup: key id differs');
      fileHeader = Buffer.from(pending.subarray(0, HEADER_LEN));
      headerDone = true;
      pending = Buffer.from(pending.subarray(HEADER_LEN));
    }
    let offset = 0;
    while (pending.length - offset > 0) {
      if (sawLast) throw new BackupFormatError('trailing-data', 'backup: data after the final chunk');
      if (pending.length - offset < LEN_BYTES) break;
      const len = pending.readUInt32BE(offset);
      if (len > BACKUP_CHUNK_BYTES) throw new BackupFormatError('auth-failed', 'backup: chunk length out of range');
      const total = LEN_BYTES + NONCE_BYTES + len + TAG_BYTES;
      if (pending.length - offset < total) break;
      const nonce = pending.subarray(offset + LEN_BYTES, offset + LEN_BYTES + NONCE_BYTES);
      const body = pending.subarray(offset + LEN_BYTES + NONCE_BYTES, offset + LEN_BYTES + NONCE_BYTES + len);
      const tag = pending.subarray(offset + total - TAG_BYTES, offset + total);
      const plain = open(key, fileHeader, nonce, body, tag, index);
      index += 1;
      if (plain.last) sawLast = true;
      if (plain.data.length > 0) t.push(plain.data);
      offset += total;
    }
    if (offset > 0) pending = Buffer.from(pending.subarray(offset));
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
        parse(this);
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
    flush(cb: TransformCallback) {
      if (!headerDone) return cb(new BackupFormatError('bad-header', 'backup: header missing'));
      if (pending.length > 0) {
        return cb(new BackupFormatError(sawLast ? 'trailing-data' : 'truncated', sawLast ? 'backup: data after the final chunk' : 'backup: truncated chunk'));
      }
      if (!sawLast) return cb(new BackupFormatError('truncated', 'backup: final chunk missing'));
      cb();
    },
  });
}

/** Одна частина: спершу як остання, потім як ні — AAD має прапор, тож вірний варіант лише один. */
function open(key: Buffer, fileHeader: Buffer, nonce: Buffer, body: Buffer, tag: Buffer, index: number): { data: Buffer; last: boolean } {
  for (const last of [false, true]) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(aadOf(fileHeader, index, last));
      decipher.setAuthTag(tag);
      const data = Buffer.concat([decipher.update(body), decipher.final()]);
      return { data, last };
    } catch {
      // інший прапор або справжня відмова автентифікації
    }
  }
  throw new BackupFormatError('auth-failed', 'backup: chunk authentication failed');
}
