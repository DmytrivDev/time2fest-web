// @ts-check
/**
 * Fake SMTP server for tests (SPEC-10 W3, AC-37/38/53/55). `node:net` only, no dependencies, no TLS.
 * Minimal ESMTP: EHLO/HELO, AUTH PLAIN|LOGIN (user `bad` → 535), MAIL FROM, RCPT TO, DATA, RSET, NOOP, QUIT.
 * The answer depends on a tag in the recipient's local part (`user+<tag>@host`), see README.md.
 * Accepted messages are kept in memory (`messages()`); `connections()` logs each transaction with the
 * recipient hashed. Nothing about recipients or message bodies is ever printed.
 * Tests: `startFakeSmtp({ port: 0 })`; stack: `node fakes/smtp/server.mjs --port 2525 --host 0.0.0.0` (compose `fake-smtp`).
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

const SLOW_MS = 10_000;
const MAX_LINE = 4096;
const MAX_DATA = 1024 * 1024;

/** @typedef {'q451' | 'q550' | 'rate' | 'rcpt550' | 'slow' | 'ok'} FakeSmtpTag */
/** @typedef {{ from: string, to: string[], raw: string, at: string }} FakeSmtpMessage */
/** @typedef {{ id: number, rcptHashes: string[], tag: FakeSmtpTag, outcome: string, at: string }} FakeSmtpTransaction */

/** Data reply per tag (after the message body); `null` — accept. @type {Record<FakeSmtpTag, string | null>} */
const DATA_REPLY = {
  q451: '451 4.7.1 Daily sending quota exceeded',
  q550: '550 5.7.1 daily quota exceeded',
  rate: '451 4.7.1 Too many requests',
  rcpt550: null,
  slow: null,
  ok: null,
};

/** @param {string} address @returns {FakeSmtpTag} */
export function tagOf(address) {
  const local = address.split('@')[0] ?? '';
  const plus = local.lastIndexOf('+');
  const tag = plus >= 0 ? local.slice(plus + 1).toLowerCase() : '';
  return tag === 'q451' || tag === 'q550' || tag === 'rate' || tag === 'rcpt550' || tag === 'slow' ? tag : 'ok';
}

/** @param {string} s */
const hash = (s) => createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 16);

/** @param {string} arg e.g. `FROM:<a@b> SIZE=10` or `TO:<a@b>` */
function addressOf(arg) {
  const m = /<([^>]*)>/.exec(arg);
  return (m ? m[1] : (arg.split(':')[1] ?? '').trim().split(/\s+/)[0]) ?? '';
}

/** @param {string} b64 */
const unb64 = (b64) => Buffer.from(b64.trim(), 'base64').toString('utf8');

/**
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ port: number, close: () => Promise<void>, connections: () => FakeSmtpTransaction[], messages: () => FakeSmtpMessage[] }>}
 */
export async function startFakeSmtp({ port = 0, host = '127.0.0.1' } = {}) {
  /** @type {FakeSmtpMessage[]} */
  const kept = [];
  /** @type {FakeSmtpTransaction[]} */
  const log = [];
  /** @type {Set<import('node:net').Socket>} */
  const sockets = new Set();
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  let nextId = 0;

  const server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sock.destroy());
    sock.setEncoding('utf8');

    /** @type {'cmd' | 'data' | 'auth-plain' | 'auth-login-user' | 'auth-login-pass'} */
    let mode = 'cmd';
    let buf = '';
    let data = '';
    let from = '';
    /** @type {string[]} */
    let to = [];
    /** @type {FakeSmtpTag} */
    let tag = 'ok';
    let loginUser = '';

    /** @param {string} line */
    const reply = (line) => {
      if (!sock.destroyed) sock.write(`${line}\r\n`);
    };
    const reset = () => {
      from = '';
      to = [];
      tag = 'ok';
      data = '';
    };
    /** @param {string} outcome */
    const record = (outcome) => {
      nextId += 1;
      log.push({ id: nextId, rcptHashes: to.map(hash), tag, outcome, at: new Date().toISOString() });
    };
    /** @param {string} user */
    const authResult = (user) => reply(user === 'bad' ? '535 5.7.8 Authentication credentials invalid' : '235 2.7.0 Authentication successful');

    const finishData = () => {
      const raw = data;
      const answer = DATA_REPLY[tag];
      if (answer) {
        record(answer.slice(0, 3));
        reply(answer);
      } else {
        kept.push({ from, to: [...to], raw, at: new Date().toISOString() });
        record('250');
        reply('250 2.0.0 OK queued');
      }
      reset();
    };

    /** @param {string} line */
    const onLine = (line) => {
      if (mode === 'data') {
        if (line === '.') {
          mode = 'cmd';
          finishData();
          return;
        }
        if (data.length < MAX_DATA) data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }
      if (mode === 'auth-plain') {
        mode = 'cmd';
        authResult(unb64(line).split('\u0000')[1] ?? '');
        return;
      }
      if (mode === 'auth-login-user') {
        loginUser = unb64(line);
        mode = 'auth-login-pass';
        reply('334 UGFzc3dvcmQ6');
        return;
      }
      if (mode === 'auth-login-pass') {
        mode = 'cmd';
        authResult(loginUser);
        return;
      }
      const sp = line.indexOf(' ');
      const verb = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
      const arg = sp < 0 ? '' : line.slice(sp + 1);
      switch (verb) {
        case 'EHLO':
          reply('250-fake-smtp');
          reply('250-AUTH PLAIN LOGIN');
          reply('250-8BITMIME');
          reply('250 SMTPUTF8');
          return;
        case 'HELO':
          reply('250 fake-smtp');
          return;
        case 'AUTH': {
          const [mech, initial] = arg.split(/\s+/);
          const m = (mech ?? '').toUpperCase();
          if (m === 'PLAIN') {
            if (initial) authResult(unb64(initial).split('\u0000')[1] ?? '');
            else {
              mode = 'auth-plain';
              reply('334 ');
            }
          } else if (m === 'LOGIN') {
            if (initial) {
              loginUser = unb64(initial);
              mode = 'auth-login-pass';
              reply('334 UGFzc3dvcmQ6');
            } else {
              mode = 'auth-login-user';
              reply('334 VXNlcm5hbWU6');
            }
          } else reply('504 5.5.4 Unrecognized authentication type');
          return;
        }
        case 'MAIL':
          reset();
          from = addressOf(arg);
          reply('250 2.1.0 OK');
          return;
        case 'RCPT': {
          const address = addressOf(arg);
          const t = tagOf(address);
          if (t === 'rcpt550') {
            nextId += 1;
            log.push({ id: nextId, rcptHashes: [hash(address)], tag: t, outcome: '550-rcpt', at: new Date().toISOString() });
            reply('550 5.1.1 No such user');
            return;
          }
          if (to.length === 0) tag = t;
          to.push(address);
          reply('250 2.1.5 OK');
          return;
        }
        case 'DATA':
          if (to.length === 0) {
            reply('503 5.5.1 Need RCPT');
            return;
          }
          if (tag === 'slow') {
            record('slow');
            const timer = setTimeout(() => {
              timers.delete(timer);
              mode = 'data';
              reply('354 Go ahead');
            }, SLOW_MS);
            timers.add(timer);
            return;
          }
          mode = 'data';
          data = '';
          reply('354 Go ahead');
          return;
        case 'RSET':
          reset();
          reply('250 2.0.0 OK');
          return;
        case 'NOOP':
          reply('250 2.0.0 OK');
          return;
        case 'QUIT':
          reply('221 2.0.0 Bye');
          sock.end();
          return;
        default:
          reply('502 5.5.2 Command not recognized');
      }
    };

    sock.on('data', (chunk) => {
      buf += String(chunk);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        onLine(line);
      }
      if (buf.length > MAX_LINE && mode !== 'data') {
        reply('500 5.5.2 Line too long');
        sock.destroy();
      }
    });
    reply('220 fake-smtp ESMTP ready');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    port: address.port,
    connections: () => [...log],
    messages: () => [...kept],
    close: () =>
      new Promise((resolve) => {
        for (const t of timers) clearTimeout(t);
        timers.clear();
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  /** @param {string} name */
  const argOf = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const { port } = await startFakeSmtp({ port: Number(argOf('--port') ?? 2525), host: argOf('--host') ?? '127.0.0.1' });
  process.stdout.write(`fake SMTP listening on port ${port}\n`);
}
