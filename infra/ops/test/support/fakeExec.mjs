// @ts-check
// Підставний виконавець для тестів ops: записує `{ transport, argv, inputLength }` (байти входу — ніколи)
// і повертає заскриптовані результати за збігом. Ті самі перевірки аргументів, що й справжній `exec.mjs`.
import { assertAllowed, assertArgv, DEFAULT_REMOTE_ALLOW, ExecRefusal, sshBaseArgs } from '../../lib/exec.mjs';

/**
 * @typedef {import('../../lib/exec.mjs').RunOpts} RunOpts
 * @typedef {import('../../lib/exec.mjs').RunResult} RunResult
 * @typedef {import('../../lib/exec.mjs').Transport} Transport
 * @typedef {{ transport: string, argv: string[], inputLength: number }} FakeCall
 * @typedef {(call: FakeCall) => boolean} Matcher
 * @typedef {{
 *   match: Matcher | RegExp | string[],
 *   result?: Partial<RunResult> | ((call: FakeCall) => Partial<RunResult> | Promise<Partial<RunResult>>),
 *   transport?: string,
 * }} Script `match` — функція, RegExp над `argv.join(' ')` або префікс argv; перший збіг виграє.
 */

/**
 * @param {Script[]} [script]
 * @param {{ fallback?: Partial<RunResult> }} [o] результат, коли жоден запис не збігся (за замовчуванням код 0)
 */
export function createFakeExec(script = [], o = {}) {
  /** @type {FakeCall[]} */
  const calls = [];

  /** @param {Script} s @param {FakeCall} call */
  const matches = (s, call) => {
    if (s.transport !== undefined && s.transport !== call.transport) return false;
    if (typeof s.match === 'function') return s.match(call);
    if (s.match instanceof RegExp) return s.match.test(call.argv.join(' '));
    const prefix = s.match;
    return prefix.every((p, i) => call.argv[i] === p);
  };

  /** @param {RunOpts['input']} input */
  const lengthOf = async (input) => {
    if (input === undefined) return 0;
    if (typeof input === 'string') return Buffer.byteLength(input);
    let n = 0;
    for await (const chunk of input) n += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return n;
  };

  /**
   * @param {string} transport
   * @param {string[]} argv
   * @param {RunOpts} [opts]
   * @returns {Promise<RunResult>}
   */
  async function record(transport, argv, opts = {}) {
    const call = { transport, argv: [...argv], inputLength: await lengthOf(opts.input) };
    calls.push(call);
    const s = script.find((x) => matches(x, call));
    const raw = s?.result === undefined ? (o.fallback ?? {}) : typeof s.result === 'function' ? await s.result(call) : s.result;
    const r = { code: raw.code ?? 0, stdout: raw.stdout ?? '', stderr: raw.stderr ?? '', ...(raw.timedOut ? { timedOut: true } : {}) };
    if (opts.onLine) {
      for (const name of /** @type {const} */ (['stdout', 'stderr'])) {
        const lines = r[name].split(/\r?\n/);
        if (lines[lines.length - 1] === '') lines.pop();
        for (const line of lines) opts.onLine(name, line);
      }
    }
    return r;
  }

  /**
   * @param {'local' | string} name
   * @param {AllowEntry[] | undefined} defaultAllow
   * @returns {Transport}
   */
  const transport = (name, defaultAllow) => ({
    kind: name === 'local' ? 'local' : 'ssh',
    describe: name,
    exec(argv, opts = {}) {
      if (!argv.length) throw new ExecRefusal('порожня команда');
      assertArgv(argv);
      const allow = opts.allow ?? defaultAllow;
      if (allow) assertAllowed(argv, allow);
      return record(name, argv, opts);
    },
  });

  return {
    calls,
    /** Виклики через певний транспорт (`local`, `ssh:<host>`, `run`). @param {string} name */
    callsOf: (name) => calls.filter((c) => c.transport === name),
    /** @param {string} file @param {string[]} args @param {RunOpts} [opts] */
    run(file, args, opts = {}) {
      assertArgv([file, ...args]);
      if (opts.allow) assertAllowed(args, opts.allow);
      return record('run', [file, ...args], opts);
    },
    localTransport: () => transport('local', undefined),
    /** @param {import('../../lib/exec.mjs').SshOpts} so */
    sshTransport: (so) => {
      sshBaseArgs(so);
      return transport(`ssh:${String(so.host).toLowerCase()}`, DEFAULT_REMOTE_ALLOW);
    },
  };
}

/** @typedef {import('../../lib/exec.mjs').AllowEntry} AllowEntry */
