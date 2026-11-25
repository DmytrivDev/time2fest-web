/**
 * SMTP-транспорт пошти (ring 4, SPEC-10 [П-7], W19; AC-37, AC-48, NFR-3) — єдиний файл, що знає Nodemailer.
 *
 * Власна черга перед пулом Nodemailer (SPEC-10 F1, [А14]): не більше 5 листів одночасно й не більше 8 листів за
 * будь-яке вікно 1 с (NFR-3: ліміт Resend 10/с); коди виходять із черги раніше за інші листи. Перегони 4 с на спробу
 * починаються лише з виходу з черги — очікування в черзі не є збоєм постачальника. Лист, що пролежав у черзі
 * понад 15 с (або транспорт закрито), повертає `MAIL_QUEUE_OVERFLOW` без передачі постачальнику. `backlog()` —
 * довжина черги (для перетікання навантаження в `mail/service.ts`). Тайм-аути з'єднання й привітання 3 с, сокета
 * 5 с, DNS 2 с, `secure` лише на 465. Поза loopback STARTTLS обов'язковий; на loopback (Mailpit, фейк) TLS не вмикається.
 *
 * Ніколи не кидає: відмова — `{ok:false, err:{code, responseCode, command, response}}`; `response` — лише для
 * класифікації (`domain/mail/classify.ts`), у лог не йде. Лог — один рядок `mail-send` на спробу: постачальник,
 * результат, код і число відповіді. Ні адреси, ні тексту відповіді, ні пароля (AC-48).
 */
import nodemailer from 'nodemailer';
import { monotonicClock } from '../clock';
import { MAIL_QUEUE_OVERFLOW, type MailMessage, type MailSendError, type MailTransport, type MailTransportResult } from '../mail/ports';
import { isLoopbackHost } from '../platform/env';
import type { Logger } from '../ports';

/** Перегони однієї SMTP-транзакції — від виходу з черги. */
export const SMTP_ATTEMPT_TIMEOUT_MS = 4000;
/** NFR-3: листів на `SMTP_RATE_DELTA_MS` на постачальника. */
export const SMTP_RATE_LIMIT = 8;
export const SMTP_RATE_DELTA_MS = 1000;
export const SMTP_MAX_CONNECTIONS = 5;
/** Найдовше очікування в черзі транспорту; далі — `MAIL_QUEUE_OVERFLOW`. */
export const SMTP_QUEUE_MAX_WAIT_MS = 15_000;

export interface SmtpTransportOptions {
  /** Мітка для логу й лічильників (`primary` / `fallback`). */
  provider: string;
  host: string;
  port: number;
  user?: string;
  /** Лише з env (`secret: true`). */
  password?: string;
  log?: Logger;
  /** Лише тести: перегони спроби від виходу з черги (типово 4 с). */
  attemptTimeoutMs?: number;
  /** Лише тести: найдовше очікування в черзі (типово 15 с). */
  queueMaxWaitMs?: number;
}

export interface SmtpTransport extends MailTransport {
  backlog(): number;
  close(): void;
}

interface Job {
  readonly msg: MailMessage;
  readonly resolve: (r: MailTransportResult) => void;
  overflow?: ReturnType<typeof setTimeout>;
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
    // Темп і число одночасних листів тримає власна черга нижче (не більше SMTP_MAX_CONNECTIONS у польоті), тож пул
    // Nodemailer не ставить листи у свою чергу й не додає очікування до перегонів.
    pool: true,
    maxConnections: SMTP_MAX_CONNECTIONS,
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
  const queueMaxWaitMs = opts.queueMaxWaitMs ?? SMTP_QUEUE_MAX_WAIT_MS;
  const codes: Job[] = [];
  const others: Job[] = [];
  /** Моменти виходу з черги за останнє вікно темпу. */
  const starts: number[] = [];
  let inFlight = 0;
  let pumpTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function logOutcome(outcome: 'sent' | 'failed', err?: MailSendError): void {
    opts.log?.info({
      event: 'mail-send',
      provider: opts.provider,
      outcome,
      ...(err ? { code: err.code, responseCode: err.responseCode } : {}),
    });
  }

  /** Одна SMTP-транзакція; перегони — від цього моменту. Слот звільняється, коли транзакція справді завершилась. */
  async function transact(msg: MailMessage): Promise<MailTransportResult> {
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
      .catch((e: unknown): MailTransportResult => ({ ok: false, err: smtpErrorOf(e) }))
      .finally(() => {
        inFlight -= 1;
        pump();
      });
    const result = await Promise.race([attempt, timeout]);
    clearTimeout(timer);
    return result;
  }

  function finish(job: Job, result: MailTransportResult): void {
    if (result.ok) logOutcome('sent');
    else logOutcome('failed', result.err);
    job.resolve(result);
  }

  /** Випускає з черги, поки є вільний слот і місце у вікні темпу; інакше — таймер на звільнення вікна. */
  function pump(): void {
    while (!closed && inFlight < SMTP_MAX_CONNECTIONS && (codes.length > 0 || others.length > 0)) {
      const now = monotonicClock.now();
      while (starts.length > 0 && now - starts[0]! >= SMTP_RATE_DELTA_MS) starts.shift();
      if (starts.length >= SMTP_RATE_LIMIT) {
        if (pumpTimer === undefined) {
          pumpTimer = setTimeout(() => {
            pumpTimer = undefined;
            pump();
          }, starts[0]! + SMTP_RATE_DELTA_MS - now);
        }
        return;
      }
      const job = (codes.length > 0 ? codes : others).shift()!;
      clearTimeout(job.overflow);
      starts.push(now);
      inFlight += 1;
      void transact(job.msg).then((r) => finish(job, r));
    }
  }

  function drop(queue: Job[], job: Job): void {
    const i = queue.indexOf(job);
    if (i < 0) return;
    queue.splice(i, 1);
    clearTimeout(job.overflow);
    finish(job, { ok: false, err: { code: MAIL_QUEUE_OVERFLOW } });
  }

  return {
    send(msg: MailMessage): Promise<MailTransportResult> {
      if (closed) return Promise.resolve({ ok: false, err: { code: MAIL_QUEUE_OVERFLOW } });
      return new Promise<MailTransportResult>((resolve) => {
        const job: Job = { msg, resolve };
        const queue = msg.class === 'code' ? codes : others;
        queue.push(job);
        job.overflow = setTimeout(() => drop(queue, job), queueMaxWaitMs);
        pump();
      });
    },
    backlog() {
      return codes.length + others.length;
    },
    close() {
      closed = true;
      clearTimeout(pumpTimer);
      for (const queue of [codes, others]) for (const job of [...queue]) drop(queue, job);
      transporter.close();
    },
  };
}
