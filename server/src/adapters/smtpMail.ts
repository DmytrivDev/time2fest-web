/**
 * SMTP-транспорт пошти (ring 4, SPEC-10 [П-7], W19; AC-37, AC-48, NFR-3) — єдиний файл, що знає Nodemailer.
 * Простий відправник: одна SMTP-транзакція на `send`. Черга, темп, пріоритет кодів, перегони 4 с і рядок логу
 * `mail-send` — в обгортці `mail/queue.ts` (кожен постачальник загорнутий у свою чергу в `container.ts`).
 * Тайм-аути з'єднання й привітання 3 с, сокета 5 с, DNS 2 с, `secure` лише на 465. Поза loopback STARTTLS
 * обов'язковий; на loopback (Mailpit, фейк) TLS не вмикається.
 *
 * Ніколи не кидає: відмова — `{ok:false, err:{code, responseCode, command, response}}`; `response` — лише для
 * класифікації (`domain/mail/classify.ts`), у лог не йде. Ні адреси, ні тексту відповіді, ні пароля (AC-48).
 */
import nodemailer from 'nodemailer';
import { MAIL_MAX_IN_FLIGHT, type ClosableMailTransport } from '../mail/queue';
import type { MailMessage, MailSendError, MailTransportResult } from '../mail/ports';
import { isLoopbackHost } from '../platform/env';

export interface SmtpTransportOptions {
  host: string;
  port: number;
  user?: string;
  /** Лише з env (`secret: true`). */
  password?: string;
}

export type SmtpTransport = ClosableMailTransport;

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
    // Темп і число одночасних листів тримає черга `mail/queue.ts` (не більше MAIL_MAX_IN_FLIGHT у польоті), тож пул
    // Nodemailer не ставить листи у свою чергу й не додає очікування до перегонів.
    pool: true,
    maxConnections: MAIL_MAX_IN_FLIGHT,
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

  return {
    /** Одна SMTP-транзакція. */
    send(msg: MailMessage): Promise<MailTransportResult> {
      const headers: Record<string, string> = {};
      let from: string | undefined;
      let messageId: string | undefined;
      for (const [k, v] of Object.entries(msg.headers)) {
        const lower = k.toLowerCase();
        if (lower === FROM) from = v;
        else if (lower === MESSAGE_ID) messageId = v;
        else headers[k] = v;
      }
      return transporter
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
    },
    close() {
      transporter.close();
    },
  };
}
