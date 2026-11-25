/**
 * SMTP-транспорт пошти (ring 4, SPEC-10 [П-7], W19; AC-37, AC-48, NFR-3) — єдиний файл, що знає Nodemailer.
 *
 * Пул: 5 з'єднань, не більше 8 листів за секунду (NFR-3: ліміт Resend 10/с), тайм-аути з'єднання й привітання
 * 3 с, сокета 5 с, DNS 2 с, `secure` лише на 465; поверх — зовнішні перегони 4 с на спробу (листу, що чекає в
 * черзі пулу, теж). Поза loopback STARTTLS обов'язковий; на loopback (Mailpit, фейк) TLS не вмикається.
 *
 * Ніколи не кидає: відмова — `{ok:false, err:{code, responseCode, command, response}}`; `response` — лише для
 * класифікації (`domain/mail/classify.ts`), у лог не йде. Лог — один рядок `mail-send` на спробу: постачальник,
 * результат, код і число відповіді. Ні адреси, ні тексту відповіді, ні пароля (AC-48).
 */
import nodemailer from 'nodemailer';
import type { MailMessage, MailSendError, MailTransport, MailTransportResult } from '../mail/ports';
import { isLoopbackHost } from '../platform/env';
import type { Logger } from '../ports';

export const SMTP_ATTEMPT_TIMEOUT_MS = 4000;
/** NFR-3: листів на `SMTP_RATE_DELTA_MS` на постачальника. */
export const SMTP_RATE_LIMIT = 8;
export const SMTP_RATE_DELTA_MS = 1000;

export interface SmtpTransportOptions {
  /** Мітка для логу й лічильників (`primary` / `fallback`). */
  provider: string;
  host: string;
  port: number;
  user?: string;
  /** Лише з env (`secret: true`). */
  password?: string;
  log?: Logger;
  /** Лише тести: зовнішні перегони спроби (типово 4 с). */
  attemptTimeoutMs?: number;
}

export interface SmtpTransport extends MailTransport {
  close(): void;
}

const MESSAGE_ID = 'message-id';
const FROM = 'from';

/** Помилка Nodemailer → поля для класифікації (решта відкидається). */
export function smtpErrorOf(e: unknown): MailSendError {
  if (typeof e !== 'object' || e === null) return { code: 'EUNKNOWN' };
  const o = e as Record<string, unknown>;
  return {
    code: typeof o.code === 'string' ? o.code : 'EUNKNOWN',
    ...(typeof o.responseCode === 'number' ? { responseCode: o.responseCode } : {}),
    ...(typeof o.command === 'string' ? { command: o.command } : {}),
    ...(typeof o.response === 'string' ? { response: o.response } : {}),
  };
}

export function createSmtpTransport(opts: SmtpTransportOptions): SmtpTransport {
  const loopback = isLoopbackHost(opts.host);
  const secure = opts.port === 465;
  const transporter = nodemailer.createTransport({
    pool: true,
    maxConnections: 5,
    rateLimit: SMTP_RATE_LIMIT,
    rateDelta: SMTP_RATE_DELTA_MS,
    host: opts.host,
    port: opts.port,
    secure,
    ignoreTLS: loopback && !secure,
    requireTLS: !loopback && !secure,
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 5000,
    dnsTimeout: 2000,
    ...(opts.user !== undefined ? { auth: { user: opts.user, pass: opts.password ?? '' } } : {}),
    logger: false,
    debug: false,
  });
  const timeoutMs = opts.attemptTimeoutMs ?? SMTP_ATTEMPT_TIMEOUT_MS;

  function logOutcome(outcome: 'sent' | 'failed', err?: MailSendError): void {
    opts.log?.info({
      event: 'mail-send',
      provider: opts.provider,
      outcome,
      ...(err ? { code: err.code, responseCode: err.responseCode } : {}),
    });
  }

  return {
    async send(msg: MailMessage): Promise<MailTransportResult> {
      const headers: Record<string, string> = {};
      let from: string | undefined;
      let messageId: string | undefined;
      for (const [k, v] of Object.entries(msg.headers)) {
        const lower = k.toLowerCase();
        if (lower === FROM) from = v;
        else if (lower === MESSAGE_ID) messageId = v;
        else headers[k] = v;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<MailTransportResult>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, err: { code: 'ETIMEDOUT' } }), timeoutMs);
      });
      const attempt = transporter
        .sendMail({
          ...(from !== undefined ? { from } : {}),
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          headers,
          ...(messageId !== undefined ? { messageId } : {}),
        })
        .then((): MailTransportResult => ({ ok: true }))
        .catch((e: unknown): MailTransportResult => ({ ok: false, err: smtpErrorOf(e) }));
      const result = await Promise.race([attempt, timeout]);
      clearTimeout(timer);
      if (result.ok) logOutcome('sent');
      else logOutcome('failed', result.err);
      return result;
    },
    close() {
      transporter.close();
    },
  };
}
