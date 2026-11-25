/**
 * SPEC-10 W3 (AC-37, AC-38, AC-53): the fake SMTP answers by recipient tag the way real providers do,
 * as seen through a Nodemailer transport. Loopback only, port 0, no TLS.
 */
import nodemailer from 'nodemailer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeSmtp, tagOf } from '../../../fakes/smtp/server.mjs';

let fake: Awaited<ReturnType<typeof startFakeSmtp>>;

const transport = (user = 'fake-user', socketTimeout = 5000) =>
  nodemailer.createTransport({
    host: '127.0.0.1',
    port: fake.port,
    secure: false,
    ignoreTLS: true,
    auth: { user, pass: 'fake-pass' }, // check-secrets: allow test fake
    socketTimeout,
    connectionTimeout: 2000,
    greetingTimeout: 2000,
  });

const send = (to: string, t = transport()) =>
  t.sendMail({ from: 'noreply@example.test', to, subject: 'Код', text: 'Ваш код: 123456' });

type SmtpError = { code?: string; responseCode?: number; command?: string };

async function failure(p: Promise<unknown>): Promise<SmtpError> {
  try {
    await p;
  } catch (e) {
    return e as SmtpError;
  }
  throw new Error('expected a failure');
}

beforeAll(async () => {
  fake = await startFakeSmtp({ port: 0 });
});
afterAll(async () => {
  await fake.close();
});

describe('fake SMTP', () => {
  it('parses the tag from the local part', () => {
    expect(tagOf('a+q451@example.test')).toBe('q451');
    expect(tagOf('a+RCPT550@example.test')).toBe('rcpt550');
    expect(tagOf('a+other@example.test')).toBe('ok');
    expect(tagOf('a@example.test')).toBe('ok');
  });

  it('accepts a plain recipient and keeps the message', async () => {
    const info = await send('ok-user@example.test');
    expect(info.accepted).toEqual(['ok-user@example.test']);
    const last = fake.messages().at(-1);
    expect(last?.to).toEqual(['ok-user@example.test']);
    expect(last?.raw).toContain('Subject:');
    const tx = fake.connections().at(-1);
    expect(tx?.outcome).toBe('250');
    expect(JSON.stringify(tx)).not.toContain('ok-user');
  });

  it.each([
    ['q451', 451],
    ['q550', 550],
    ['rate', 451],
  ])('+%s → EMESSAGE %i after DATA', async (tag, code) => {
    const err = await failure(send(`u+${tag}@example.test`));
    expect(err.code).toBe('EMESSAGE');
    expect(err.responseCode).toBe(code);
    expect(err.command).toBe('DATA');
  });

  it('+rcpt550 → EENVELOPE 550 at RCPT TO', async () => {
    const err = await failure(send('u+rcpt550@example.test'));
    expect(err.code).toBe('EENVELOPE');
    expect(err.responseCode).toBe(550);
    expect(err.command).toBe('RCPT TO');
  });

  it('+slow → ETIMEDOUT with a 1 s socket timeout', async () => {
    const err = await failure(send('u+slow@example.test', transport('fake-user', 1000)));
    expect(err.code).toBe('ETIMEDOUT');
  });

  it('login user `bad` → EAUTH 535', async () => {
    const err = await failure(send('ok-user@example.test', transport('bad')));
    expect(err.code).toBe('EAUTH');
    expect(err.responseCode).toBe(535);
  });
});
