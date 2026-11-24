/**
 * Формат `T2FB1` (SPEC-13b AC-41, AC-55 — половина розшифрування, W23): потоковий обіг 200 МБ рівний за sha256 і
 * з обмеженою пам'яттю; обрізання, перестановка, змінений байт, чужий ключ, дані після останньої частини —
 * відмова; перші байти — `T2FB1`, не `PGDMP`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_CHUNK_BYTES,
  BackupFormatError,
  decryptStream,
  encryptStream,
  keyIdOf,
  parseBackupKey,
} from '../../src/ops/backupFormat';

// Фіксований тестовий ключ, не справжній. check-secrets: allow test fixture
const KEY_B64 = 'dGVzdC1iYWNrdXAta2V5LW5vdC1yZWFsLTMyYnl0ZXM='; // check-secrets: allow test fixture
const KEY = parseBackupKey(KEY_B64);
const ID = keyIdOf(KEY);
const OTHER = Buffer.alloc(32, 7);

const HEADER = 30;
const FRAME = 4 + 12 + 16;

async function collect(src: Readable, through: Transform): Promise<Buffer> {
  const parts: Buffer[] = [];
  await pipeline(src, through, new Writable({ write: (c: Buffer, _e, cb) => (parts.push(c), cb()) }));
  return Buffer.concat(parts);
}

const enc = (plain: Buffer) => collect(Readable.from([plain]), encryptStream(KEY, ID));
const dec = (data: Buffer, key = KEY, id = ID) => collect(Readable.from([data]), decryptStream(key, id));

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof BackupFormatError ? err.code : `other:${String(err)}`;
  }
}

/** Межі частин у шифрованому файлі (після заголовка). */
function frames(data: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let off = HEADER;
  while (off < data.length) {
    const len = data.readUInt32BE(off);
    out.push(data.subarray(off, off + FRAME + len));
    off += FRAME + len;
  }
  return out;
}

describe('backup format T2FB1', () => {
  it('key: 32 bytes of base64 only; the key id is 8 hex of sha256; errors never carry the value', () => {
    expect(ID).toMatch(/^[0-9a-f]{8}$/);
    expect(ID).toBe(createHash('sha256').update(KEY).digest('hex').slice(0, 8));
    for (const bad of ['', 'abc', Buffer.alloc(16).toString('base64'), `${KEY_B64}!!`]) {
      try {
        parseBackupKey(bad);
        expect.unreachable();
      } catch (err) {
        expect((err as Error).message).toBe('T2F_BACKUP_KEY: must be 32 bytes of base64');
      }
    }
  });

  it('round-trips small, empty and chunk-boundary inputs; the file starts with T2FB1, not PGDMP', async () => {
    for (const size of [0, 1, BACKUP_CHUNK_BYTES - 1, BACKUP_CHUNK_BYTES, BACKUP_CHUNK_BYTES + 1, 3 * BACKUP_CHUNK_BYTES]) {
      const plain = Buffer.concat([Buffer.from('PGDMP'), randomBytes(size)]).subarray(0, size);
      const data = await enc(plain);
      expect(data.subarray(0, 5).toString('ascii')).toBe('T2FB1');
      expect(data[5]).toBe(2);
      expect(data.subarray(6, 14).toString('ascii')).toBe(ID);
      expect(data.length).toBeGreaterThanOrEqual(HEADER);
      expect(data.includes(Buffer.from('PGDMP'))).toBe(false);
      expect((await dec(data)).equals(plain)).toBe(true);
    }
  });

  it('rejects truncation (inside a chunk, at a chunk boundary, header only), reordering, a flipped byte, trailing data', async () => {
    const data = await enc(randomBytes(3 * BACKUP_CHUNK_BYTES + 100));
    const fs = frames(data);
    expect(fs.length).toBe(4);
    const header = data.subarray(0, HEADER);

    expect(await code(dec(data.subarray(0, data.length - 1)))).toBe('truncated');
    expect(await code(dec(Buffer.concat([header, fs[0]!, fs[1]!])))).toBe('truncated');
    expect(await code(dec(header))).toBe('truncated');
    expect(await code(dec(data.subarray(0, 10)))).toBe('bad-header');
    expect(await code(dec(Buffer.concat([header, fs[1]!, fs[0]!, fs[2]!, fs[3]!])))).toBe('auth-failed');
    // Остання частина на місці передостанньої: номер у AAD інший.
    expect(await code(dec(Buffer.concat([header, fs[0]!, fs[1]!, fs[3]!])))).toBe('auth-failed');

    for (const at of [HEADER + 20, Math.floor(data.length / 2), data.length - 1]) {
      const flipped = Buffer.from(data);
      flipped[at] = flipped[at]! ^ 0x01;
      expect(await code(dec(flipped))).toBe('auth-failed');
    }
    expect(await code(dec(Buffer.concat([data, fs[0]!])))).toBe('trailing-data');
    expect(await code(dec(Buffer.concat([data, Buffer.from([0])])))).toBe('trailing-data');
  });

  it('rejects a wrong key, a wrong expected key id, a foreign file and an unknown version before any output', async () => {
    const data = await enc(randomBytes(1000));
    expect(await code(dec(data, OTHER, ID))).toBe('key-mismatch');
    expect(await code(dec(data, KEY, 'deadbeef'))).toBe('key-mismatch');
    expect(await code(dec(Buffer.concat([Buffer.from('PGDMP'), randomBytes(100)])))).toBe('bad-header');
    // Версія 0x01 (AAD без заголовка) відкинута; невідома 0x03 — теж.
    for (const version of [1, 3]) {
      const other = Buffer.from(data);
      other[5] = version;
      expect(await code(dec(other))).toBe('bad-header');
    }
    // Заголовок підмінено на id чужого ключа, частини — від нашого: id не збігається з ключем.
    const swapped = Buffer.concat([Buffer.from('T2FB1'), Buffer.from([2]), Buffer.from(keyIdOf(OTHER)), data.subarray(14)]);
    expect(await code(dec(swapped, OTHER, keyIdOf(OTHER)))).toBe('auth-failed');
  });

  it('binds the header into every chunk (S-4): two files, same key — a changed file id or spliced chunks fail', async () => {
    const plain = randomBytes(3 * BACKUP_CHUNK_BYTES + 100);
    const a = await enc(plain);
    const b = await enc(plain);
    // Кожен файл — свій випадковий id файлу.
    expect(a.subarray(14, HEADER).equals(b.subarray(14, HEADER))).toBe(false);
    const fa = frames(a);
    const fb = frames(b);
    // Частини 0..1 з A, 2..3 з B під заголовком A (і навпаки) — тег не сходиться.
    expect(await code(dec(Buffer.concat([a.subarray(0, HEADER), fa[0]!, fa[1]!, fb[2]!, fb[3]!])))).toBe('auth-failed');
    expect(await code(dec(Buffer.concat([b.subarray(0, HEADER), fa[0]!, fb[1]!, fb[2]!, fb[3]!])))).toBe('auth-failed');
    // Заголовок B над частинами A цілком.
    expect(await code(dec(Buffer.concat([b.subarray(0, HEADER), a.subarray(HEADER)])))).toBe('auth-failed');
    // Один перевернутий біт в id файлу ламає першу ж частину.
    const flippedId = Buffer.from(a);
    flippedId[20] = flippedId[20]! ^ 0x01;
    expect(await code(dec(flippedId))).toBe('auth-failed');
  });

  it('200 MB streamed round trip equals by sha256, memory stays bounded', { timeout: 120_000 }, async () => {
    const TOTAL = 200 * 1024 * 1024;
    const PIECE = 1024 * 1024;
    const seed = randomBytes(PIECE);
    const source = Readable.from(
      (function* () {
        for (let i = 0; i < TOTAL / PIECE; i += 1) {
          const piece = Buffer.from(seed);
          piece.writeUInt32BE(i, 0);
          yield piece;
        }
      })(),
    );
    const inHash = createHash('sha256');
    const outHash = createHash('sha256');
    let outBytes = 0;
    let peak = 0;
    const tapIn = new Transform({ transform: (c: Buffer, _e, cb) => (inHash.update(c), cb(null, c)) });
    const sink = new Writable({
      write: (c: Buffer, _e, cb) => {
        outHash.update(c);
        outBytes += c.length;
        peak = Math.max(peak, process.memoryUsage().rss);
        cb();
      },
    });
    const before = process.memoryUsage().rss;
    await pipeline(source, tapIn, encryptStream(KEY, ID), decryptStream(KEY, ID), sink);
    expect(outBytes).toBe(TOTAL);
    expect(outHash.digest('hex')).toBe(inHash.digest('hex'));
    // Потік: пам'ять не росте на розмір копії.
    expect(peak - before).toBeLessThan(150 * 1024 * 1024);
  });
});
