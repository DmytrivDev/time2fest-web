// @ts-check
// Підставні вузли з власним станом для O·P18a (`private-db`, `server2`): файли каталогу вузла, контейнери й мережі
// проєктів Compose, слухачі портів хоста. Кожен виклик — у транскрипт `{ host, argv, inputLength }` (байти входу —
// лише у файлах стану, не в транскрипті). `start` — лише для замка вузла (`flock … locked`).
import { PassThrough } from 'node:stream';
import { assertAllowed, assertArgv, DEFAULT_REMOTE_ALLOW } from '../../lib/exec.mjs';
import { getVar } from '../../lib/secrets/envFile.mjs';

/** Типова мережа основного вузла: публічна на eth0 (+ якірна 10.19/16), VPC на eth1, docker0. */
export const MAIN_IP_OUT = [
  '2: eth0    inet 203.0.113.10/20 metric 100 brd 203.0.127.255 scope global eth0\\       valid_lft forever preferred_lft forever',
  '2: eth0    inet 10.19.0.5/16 brd 10.19.255.255 scope global eth0\\       valid_lft forever preferred_lft forever',
  '3: eth1    inet 10.114.0.2/20 metric 100 brd 10.114.15.255 scope global eth1\\       valid_lft forever preferred_lft forever',
  '4: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever',
  '---',
  'default via 203.0.112.1 dev eth0 proto static',
  '',
].join('\n');

const BASE_LISTENERS = ['LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*', 'LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*'];

/**
 * @typedef {{ host: string, argv: string[], inputLength: number }} Call
 * @typedef {{
 *   files: Map<string, string>,
 *   containers: Map<string, string[]>,
 *   networks: Map<string, string[]>,
 *   listeners: { address: string, port: number, owner: string }[],
 *   backend: boolean,
 * }} NodeState
 */

/**
 * @param {Record<string, { ipOut?: string, files?: Record<string, string>, backend?: boolean, publishOn?: string, failUp?: boolean }>} hosts
 */
export function createFakeNodes(hosts) {
  /** @type {Call[]} */
  const calls = [];
  /** @type {Record<string, NodeState>} */
  const state = {};
  let seq = 0;
  const id = () => (++seq).toString(16).padStart(12, 'a');
  for (const [h, o] of Object.entries(hosts)) {
    state[h] = { files: new Map(Object.entries(o.files ?? {})), containers: new Map(), networks: new Map(), listeners: [], backend: o.backend ?? true };
  }

  /** @param {unknown} input */
  const text = async (input) => {
    if (input === undefined) return '';
    if (typeof input === 'string') return input;
    let s = '';
    for await (const c of /** @type {AsyncIterable<unknown>} */ (input)) s += String(c);
    return s;
  };

  /**
   * @param {string} host
   * @param {string[]} argv
   * @param {string} input
   * @returns {{ code?: number, stdout?: string }}
   */
  function handle(host, argv, input) {
    const s = /** @type {NodeState} */ (state[host]);
    const o = hosts[host] ?? {};
    const a = argv.join(' ');
    const projectOf = () => argv[argv.indexOf('-p') + 1];
    if (argv[0] === 'sh' && argv[1] === '-c') {
      const script = argv[2];
      if (script.startsWith('ip -4 -o addr')) return { stdout: o.ipOut ?? MAIN_IP_OUT };
      if (script.includes('cat > "$1.tmp"')) {
        s.files.set(argv[4], input);
        return {};
      }
      if (script === 'test ! -e "$1" || cat -- "$1"') return { stdout: s.files.get(argv[4]) ?? '' };
      if (script.includes('rm -f --')) {
        for (const name of argv.slice(5)) s.files.delete(`${argv[4]}/${name}`);
        return {};
      }
    }
    if (a.startsWith('docker network inspect')) return { code: s.backend ? 0 : 1, stdout: s.backend ? argv[argv.length - 1] : '' };
    if (a.startsWith('docker ps -aq --filter label=com.docker.compose.project=')) {
      const p = argv[argv.length - 1].split('=').pop() ?? '';
      return { stdout: (s.containers.get(p) ?? []).join('\n') };
    }
    if (a.startsWith('docker network ls -q --filter label=com.docker.compose.project=')) {
      const p = argv[argv.length - 1].split('=').pop() ?? '';
      return { stdout: (s.networks.get(p) ?? []).join('\n') };
    }
    if (a.startsWith('docker rm -f')) {
      const ids = argv.slice(3);
      for (const [p, list] of s.containers) s.containers.set(p, list.filter((x) => !ids.includes(x)));
      s.listeners = s.listeners.filter((l) => !ids.includes(l.owner));
      return {};
    }
    if (a.startsWith('docker network rm')) {
      const ids = argv.slice(3);
      for (const [p, list] of s.networks) s.networks.set(p, list.filter((x) => !ids.includes(x)));
      return {};
    }
    if (argv[0] === 'ss') return { stdout: [...BASE_LISTENERS, ...s.listeners.map((l) => `LISTEN 0      4096   ${l.address}:${l.port}        0.0.0.0:*`)].join('\n') };
    if (argv[0] === 'df') return { stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vda1 50000000 1000000 49000000 3% /\n' };
    if (argv[0] === 'grep') return { code: 2 };
    if (argv[0] === 'docker' && argv[1] === 'compose') {
      const p = projectOf();
      const envFile = argv[argv.indexOf('--env-file') + 1];
      const envText = s.files.get(envFile) ?? '';
      if (argv.includes('up')) {
        if (o.failUp) return { code: 1 };
        const c = id();
        s.containers.set(p, [c]);
        s.networks.set(p, [id()]);
        const addr = getVar(envText, 'T2F_PRIVATE_ADDR');
        if (addr) for (const port of [5432, 6379]) s.listeners.push({ address: o.publishOn ?? addr, port, owner: c });
        return {};
      }
      if (argv.includes('port')) {
        const port = Number(argv[argv.length - 1]);
        return { stdout: s.listeners.filter((l) => l.port === port).map((l) => `${l.address}:${l.port}`).join('\n') };
      }
      if (a.includes('health-probe.mjs')) return { stdout: `200 ${getVar(envText, 'T2F_SERVER_SHA') ?? ''}\n` };
    }
    return {};
  }

  /** @param {string} host */
  const transport = (host) => {
    if (!state[host]) throw new Error(`фейк: невідомий вузол ${host}`);
    return {
      kind: /** @type {const} */ ('ssh'),
      describe: `ssh:${host}`,
      /** @param {string[]} argv @param {import('../../lib/exec.mjs').RunOpts} [opts] */
      async exec(argv, opts = {}) {
        assertArgv(argv);
        assertAllowed(argv, opts.allow ?? DEFAULT_REMOTE_ALLOW);
        const input = await text(opts.input);
        calls.push({ host, argv: [...argv], inputLength: Buffer.byteLength(input) });
        const r = handle(host, argv, input);
        return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: '' };
      },
      /** Замок вузла: одразу `locked`; EOF на stdin — вихід 0. @param {string[]} argv */
      start(argv) {
        calls.push({ host, argv: [...argv], inputLength: 0 });
        const stdout = new PassThrough();
        const stdin = new PassThrough();
        /** @type {(v: { code: number, stdout: string, stderr: string }) => void} */
        let finish = () => {};
        const done = new Promise((resolve) => {
          finish = resolve;
        });
        stdin.on('finish', () => finish({ code: 0, stdout: '', stderr: '' }));
        setImmediate(() => stdout.write('locked\n'));
        return { stdout, stdin, done: /** @type {Promise<any>} */ (done), kill: () => finish({ code: 143, stdout: '', stderr: '' }) };
      },
    };
  };

  return {
    calls,
    state,
    /** Порт `transport` для `main(argv, { transport })`. @param {{ host: string } | null} ssh */
    transportPort: (ssh) => {
      if (!ssh) throw new Error('фейк: локальної цілі немає');
      return transport(ssh.host);
    },
    /** Виклики, що щось змінюють (усе, крім читання). */
    changing: () =>
      calls.filter(
        (c) =>
          !(c.argv[0] === 'sh' && (c.argv[2].startsWith('ip -4') || c.argv[2] === 'test ! -e "$1" || cat -- "$1"')) &&
          !['ss', 'df', 'grep', 'flock'].includes(c.argv[0]) &&
          !/^docker (ps|network (inspect|ls))\b/.test(c.argv.join(' ')) &&
          !(c.argv[1] === 'compose' && c.argv.includes('port')),
      ),
  };
}
