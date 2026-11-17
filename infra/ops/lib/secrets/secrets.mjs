// @ts-check
// Секрети репетиції (AC-37, AC-38, NFR-4): генерація файлів змінних вузла й заміна секрету краю.
// Значення — лише `randomBytes(32)`; живуть тільки в git-ignored `infra/ops/.local/<env>/` (0600), у файлах
// вузла (0600, `umask 077`) і в секреті Worker’а. Передаються лише через stdin — ніколи в argv, вивід чи журнал.
// Коди: 0 — готово; 2 — відмова до будь-якої зміни; 1 — крок не вдався.
import { messageOf } from '../common.mjs';
import { generate } from './generate.mjs';
import { rotate } from './rotate.mjs';

/** @typedef {import('../../ops.mjs').OpsContext} OpsContext */

/**
 * `ops edge-secret --env rehearsal --generate|--rotate`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runEdgeSecret(ctx) {
  try {
    if (ctx.args.env !== 'rehearsal') {
      ctx.err('edge-secret: лише --env rehearsal');
      return 2;
    }
    return ctx.args.flags.rotate === true ? await rotate(ctx) : await generate(ctx);
  } catch (e) {
    const code = /** @type {{ code?: unknown }} */ (e).code === 2 ? 2 : 1;
    ctx.err(`edge-secret: ${messageOf(e)}`);
    return code;
  }
}
