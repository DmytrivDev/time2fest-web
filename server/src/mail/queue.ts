/**
 * Черга перед транспортом пошти (SPEC-10 F1, [А14]; AC-48, NFR-3) — обгортка над будь-яким `MailTransport`
 * (ring 2, без знання SMTP). Кожен постачальник має свою чергу.
 *
 * Не більше 5 листів одночасно й не більше 8 листів за будь-яке вікно 1 с (NFR-3: ліміт Resend 10/с); коди виходять
 * із черги раніше за інші листи. Перегони 4 с на спробу починаються лише з виходу з черги — очікування в черзі не є
 * збоєм постачальника; слот звільняється, коли транзакція справді завершилась. Лист, що пролежав у черзі понад 15 с
 * (або чергу закрито), повертає `MAIL_QUEUE_OVERFLOW` без передачі постачальнику; так само одразу — лист, що застав
 * чергу повною (120 = 8/с × 15 с, S10-11). `backlog()` — довжина черги (для перетікання навантаження в
 * `mail/service.ts`).
 *
 * Ніколи не кидає. Лог — один рядок `mail-send` на спробу: постачальник, результат, код і число відповіді.
 * Ні адреси, ні тексту відповіді (AC-48).
 */
import { monotonicClock } from '../clock';
import type { Logger } from '../ports';
import { MAIL_QUEUE_OVERFLOW, type MailMessage, type MailSendError, type MailTransport, type MailTransportResult } from './ports';

/** Перегони однієї спроби транспорту — від виходу з черги. */
export const MAIL_ATTEMPT_TIMEOUT_MS = 4000;
/** NFR-3: листів на `MAIL_RATE_DELTA_MS` на постачальника. */
export const MAIL_RATE_LIMIT = 8;
export const MAIL_RATE_DELTA_MS = 1000;
/** Листів у польоті одночасно (= з'єднань пулу SMTP). */
export const MAIL_MAX_IN_FLIGHT = 5;
/** Найдовше очікування в черзі; далі — `MAIL_QUEUE_OVERFLOW`. */
export const MAIL_QUEUE_MAX_WAIT_MS = 15_000;
/** Найдовша черга (S10-11): більше листів за 15 с однаково не вийде; новий лист понад це — одразу `MAIL_QUEUE_OVERFLOW`. */
export const MAIL_QUEUE_MAX_LENGTH = (MAIL_RATE_LIMIT * MAIL_QUEUE_MAX_WAIT_MS) / MAIL_RATE_DELTA_MS;

/** Транспорт, який можна закрити (SMTP-пул). */
export interface ClosableMailTransport extends MailTransport {
  close(): void;
}

export interface MailQueueOptions {
  /** Мітка для логу (`primary` / `fallback`). */
  provider: string;
  log?: Logger;
  /** Лише тести: перегони спроби від виходу з черги (типово 4 с). */
  attemptTimeoutMs?: number;
  /** Лише тести: найдовше очікування в черзі (типово 15 с). */
  queueMaxWaitMs?: number;
  /** Лише тести: найдовша черга (типово `MAIL_QUEUE_MAX_LENGTH`). */
  queueMaxLength?: number;
}

export interface QueuedMailTransport extends MailTransport {
  backlog(): number;
  close(): void;
}

interface Job {
  readonly msg: MailMessage;
  readonly resolve: (r: MailTransportResult) => void;
  overflow?: ReturnType<typeof setTimeout>;
}

export function createMailQueue(inner: ClosableMailTransport, opts: MailQueueOptions): QueuedMailTransport {
  const timeoutMs = opts.attemptTimeoutMs ?? MAIL_ATTEMPT_TIMEOUT_MS;
  const queueMaxWaitMs = opts.queueMaxWaitMs ?? MAIL_QUEUE_MAX_WAIT_MS;
  const queueMaxLength = opts.queueMaxLength ?? MAIL_QUEUE_MAX_LENGTH;
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

  /** Одна спроба транспорту; перегони — від цього моменту. Слот звільняється, коли спроба справді завершилась. */
  async function attempt(msg: MailMessage): Promise<MailTransportResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<MailTransportResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, err: { code: 'ETIMEDOUT' } }), timeoutMs);
    });
    const sent = Promise.resolve()
      .then(() => inner.send(msg))
      .catch((): MailTransportResult => ({ ok: false, err: { code: 'EUNKNOWN' } }))
      .finally(() => {
        inFlight -= 1;
        pump();
      });
    const result = await Promise.race([sent, timeout]);
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
    while (!closed && inFlight < MAIL_MAX_IN_FLIGHT && (codes.length > 0 || others.length > 0)) {
      const now = monotonicClock.now();
      while (starts.length > 0 && now - starts[0]! >= MAIL_RATE_DELTA_MS) starts.shift();
      if (starts.length >= MAIL_RATE_LIMIT) {
        if (pumpTimer === undefined) {
          pumpTimer = setTimeout(() => {
            pumpTimer = undefined;
            pump();
          }, starts[0]! + MAIL_RATE_DELTA_MS - now);
        }
        return;
      }
      const job = (codes.length > 0 ? codes : others).shift()!;
      clearTimeout(job.overflow);
      starts.push(now);
      inFlight += 1;
      void attempt(job.msg).then((r) => finish(job, r));
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
      if (closed || codes.length + others.length >= queueMaxLength) return Promise.resolve({ ok: false, err: { code: MAIL_QUEUE_OVERFLOW } });
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
      inner.close();
    },
  };
}
