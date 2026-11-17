// @ts-check
// Журнал розгортань (AC-15): JSON Lines у `<nodeDir>/journal.jsonl`. На вузол — дописування через транспорт
// (`sh -c 'cat >> "$1"' _ <path>`, рядок — на вхід), локально — `fs.appendFileSync`.
// Жоден запис не несе значення секрету (NFR-4): поля — за переліком дозволеного, значення — за шаблонами,
// рядок із значенням секретної змінної чи зареєстрованим у редакторі значенням → відмова до запису.
import fs from 'node:fs';
import path from 'node:path';
import { ENVS } from './config.mjs';
import { createRedactor, redactorFromEnv } from './redact.mjs';

export const JOURNAL_FILE = 'journal.jsonl';

/** Відмова записати: запис недопустимий або несе секрет. Нічого не записано. */
export class JournalRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'JournalRefusal';
  }
}

/**
 * @typedef {'ok' | 'failed' | 'worker-failed' | 'rolled-back'} OutcomeResult
 * @typedef {{ kind: 'step', at: string, env: string, commit: string | null, step: string, status: string, ms: number | null }} StepRecord
 * @typedef {{
 *   kind: 'deploy' | 'rollback', at: string, env: string, commit: string | null,
 *   imageBefore: string | null, imageAfter: string | null,
 *   workerVersionBefore: string | null, workerVersionAfter: string | null,
 *   edgeSecretGeneration: number, result: OutcomeResult, failedStep: string | null, downtimeSeconds?: number,
 * }} OutcomeRecord
 * @typedef {{ kind: 'edge-secret', at: string, env: string, generation: number }} EdgeSecretRecord
 * @typedef {StepRecord | OutcomeRecord | EdgeSecretRecord} JournalRecord
 */

const RE_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RE_SHA = /^[0-9a-f]{7,40}$/;
const RE_STEP = /^[a-z0-9][a-z0-9:-]{0,63}$/;
/** Образ (`t2f-server:<sha>`, `sha256:<hex>`) чи версія Worker’а (UUID): без пробілів, лапок і керівних символів. */
const RE_REF = /^[A-Za-z0-9_.:@/+-]{1,200}$/;
const RESULTS = ['ok', 'failed', 'worker-failed', 'rolled-back'];

/** @typedef {(v: unknown) => boolean} Check */
/** @type {Check} */ const isAt = (v) => typeof v === 'string' && RE_AT.test(v);
/** @type {Check} */ const isEnv = (v) => typeof v === 'string' && Object.hasOwn(ENVS, v);
/** @type {Check} */ const isShaOrNull = (v) => v === null || (typeof v === 'string' && RE_SHA.test(v));
/** @type {Check} */ const isStep = (v) => typeof v === 'string' && RE_STEP.test(v);
/** @type {Check} */ const isStepOrNull = (v) => v === null || isStep(v);
/** @type {Check} */ const isRefOrNull = (v) => v === null || (typeof v === 'string' && RE_REF.test(v));
/** @type {Check} */ const isMsOrNull = (v) => v === null || (Number.isInteger(v) && /** @type {number} */ (v) >= 0);
/** @type {Check} */ const isSeconds = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 0;
/** @type {Check} */ const isGeneration = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 1;
/** @type {Check} */ const isResult = (v) => typeof v === 'string' && RESULTS.includes(v);

/** Поля кожного виду: обов’язкові й необов’язкові. Будь-яке інше поле → відмова. */
/** @type {Record<string, { required: Record<string, Check>, optional?: Record<string, Check> }>} */
const SCHEMA = {
  step: { required: { kind: () => true, at: isAt, env: isEnv, commit: isShaOrNull, step: isStep, status: isStep, ms: isMsOrNull } },
  deploy: outcomeSchema(),
  rollback: outcomeSchema(),
  'edge-secret': { required: { kind: () => true, at: isAt, env: isEnv, generation: isGeneration } },
};

function outcomeSchema() {
  return {
    required: {
      kind: () => true,
      at: isAt,
      env: isEnv,
      commit: isShaOrNull,
      imageBefore: isRefOrNull,
      imageAfter: isRefOrNull,
      workerVersionBefore: isRefOrNull,
      workerVersionAfter: isRefOrNull,
      edgeSecretGeneration: isGeneration,
      result: isResult,
      failedStep: isStepOrNull,
    },
    optional: { downtimeSeconds: isSeconds },
  };
}

/**
 * Перевіряє запис і повертає його рядок JSON (без переводу рядка). Назви полів у повідомленні — так, значення — ні.
 * @param {unknown} record
 */
export function serializeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new JournalRefusal('запис журналу має бути об’єктом');
  const rec = /** @type {Record<string, unknown>} */ (record);
  const schema = typeof rec.kind === 'string' && Object.hasOwn(SCHEMA, rec.kind) ? SCHEMA[rec.kind] : undefined;
  if (!schema) throw new JournalRefusal('запис журналу: невідомий kind');
  for (const key of Object.keys(rec)) {
    if (!Object.hasOwn(schema.required, key) && !Object.hasOwn(schema.optional ?? {}, key)) {
      throw new JournalRefusal(`запис журналу: недозволене поле ${/^[A-Za-z0-9_-]{1,64}$/.test(key) ? key : '(ім’я з недопустимими символами)'}`);
    }
  }
  for (const [key, ok] of Object.entries(schema.required)) {
    if (!Object.hasOwn(rec, key)) throw new JournalRefusal(`запис журналу: бракує поля ${key}`);
    if (!ok(rec[key])) throw new JournalRefusal(`запис журналу: недопустиме значення поля ${key}`);
  }
  for (const [key, ok] of Object.entries(schema.optional ?? {})) {
    if (Object.hasOwn(rec, key) && !ok(rec[key])) throw new JournalRefusal(`запис журналу: недопустиме значення поля ${key}`);
  }
  // Порядок полів — як у схемі, щоб рядки читалися однаково.
  /** @type {Record<string, unknown>} */
  const ordered = {};
  for (const key of [...Object.keys(schema.required), ...Object.keys(schema.optional ?? {})]) {
    if (Object.hasOwn(rec, key)) ordered[key] = rec[key];
  }
  return JSON.stringify(ordered);
}

/** Шлях до журналу на вузлі: абсолютний POSIX без `..`, лише безпечні символи. */
const RE_REMOTE_PATH = /^\/[A-Za-z0-9_./-]+$/;

/**
 * @param {string} dir каталог вузла (`ENVS[env].nodeDir`) або локальний каталог стану
 * @param {'posix' | 'local'} [style]
 */
export function journalPath(dir, style = 'posix') {
  return style === 'posix' ? path.posix.join(dir, JOURNAL_FILE) : path.join(dir, JOURNAL_FILE);
}

/**
 * @param {{
 *   transport: import('./exec.mjs').Transport,
 *   file: string,
 *   env?: Record<string, string | undefined>,
 *   redactor?: import('./redact.mjs').Redactor,
 * }} o `env` — середовище процесу: значення його секретних змінних не потрапляють у журнал (відмова);
 *   `redactor` — той самий редактор, що й для виводу: запис із будь-яким зареєстрованим значенням — відмова.
 */
export function createJournal(o) {
  const local = o.transport.kind === 'local';
  if (local ? !path.isAbsolute(o.file) : !RE_REMOTE_PATH.test(o.file) || o.file.split('/').includes('..')) {
    throw new JournalRefusal('журнал: недопустимий шлях');
  }
  const secrets = redactorFromEnv(o.env ?? process.env);
  const redactor = o.redactor ?? createRedactor();

  return {
    file: o.file,

    /**
     * Дописує один запис. Відмова (виняток) — до будь-якого запису.
     * @param {JournalRecord} record
     */
    async append(record) {
      const json = serializeRecord(record);
      if (secrets.contains(json)) throw new JournalRefusal('запис журналу містить значення секретної змінної');
      // Маскування тут — відмова, а не заміна на `***`: замаскований рядок не пройшов би схему читача
      // й запис тихо зник би з журналу (а з ним — ціль відкату).
      if (redactor.contains(json)) throw new JournalRefusal('запис журналу містить зареєстроване секретне значення');
      const line = `${json}\n`;
      if (local) {
        fs.mkdirSync(path.dirname(o.file), { recursive: true });
        fs.appendFileSync(o.file, line, { encoding: 'utf8', mode: 0o600 });
        return;
      }
      const r = await o.transport.exec(['sh', '-c', 'cat >> "$1"', '_', o.file], {
        input: line,
        allow: ['sh', '-c', 'cat >> "$1"', '_', o.file],
        timeoutMs: 30_000,
      });
      if (r.code !== 0) throw new Error(`журнал: дописування на вузлі завершилося з кодом ${r.code}`);
    },

    /** Усі записи журналу; відсутній файл — порожній журнал. @returns {Promise<JournalRecord[]>} */
    async read() {
      if (local) return parseJournal(fs.existsSync(o.file) ? fs.readFileSync(o.file, 'utf8') : '');
      const script = 'test ! -e "$1" || cat -- "$1"';
      const r = await o.transport.exec(['sh', '-c', script, '_', o.file], {
        allow: ['sh', '-c', script, '_', o.file],
        timeoutMs: 30_000,
      });
      if (r.code !== 0) throw new Error(`журнал: читання на вузлі завершилося з кодом ${r.code}`);
      return parseJournal(r.stdout);
    },
  };
}

/** @typedef {ReturnType<typeof createJournal>} Journal */

/**
 * Рядки JSON Lines → записи. Пошкоджений чи чужий рядок пропускається (журнал лише дописується).
 * @param {string} text
 * @returns {JournalRecord[]}
 */
export function parseJournal(text) {
  /** @type {JournalRecord[]} */
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const rec = JSON.parse(line);
      serializeRecord(rec);
      out.push(rec);
    } catch {
      // пропускаємо
    }
  }
  return out;
}

/**
 * Останнє успішне розгортання середовища (`kind: 'deploy'`, `result: 'ok'`) — ціль відкату (W21).
 * @param {JournalRecord[]} records
 * @param {string} env
 * @returns {OutcomeRecord | undefined}
 */
export function lastOk(records, env) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.kind === 'deploy' && r.env === env && r.result === 'ok') return r;
  }
  return undefined;
}

/**
 * Поточне покоління секрету краю = найбільше `generation` записів `edge-secret` середовища; без записів — 1.
 * @param {JournalRecord[]} records
 * @param {string} env
 */
export function currentGeneration(records, env) {
  let g = 1;
  for (const r of records) if (r.kind === 'edge-secret' && r.env === env && r.generation > g) g = r.generation;
  return g;
}

/**
 * Коміти успішних розгортань середовища, найновіші першими, без повторів.
 * @param {JournalRecord[]} records
 * @param {string} env
 * @returns {string[]}
 */
export function deployedShas(records, env) {
  /** @type {string[]} */
  const out = [];
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.kind === 'deploy' && r.env === env && r.result === 'ok' && r.commit && !out.includes(r.commit)) out.push(r.commit);
  }
  return out;
}
