/** Поштові порти (SPEC-10 W17): один сервіс над двома SMTP-транспортами. */
import type { MailClass, MailSendError } from '../domain/mail/types';

export type { MailClass, MailSendError } from '../domain/mail/types';

export interface MailMessage {
  /** Той самий id на обох спробах (Message-ID, Resend-Idempotency-Key). */
  readonly id: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly class: MailClass;
}

export type MailTransportResult = { readonly ok: true } | { readonly ok: false; readonly err: MailSendError };

/**
 * Код відмови «лист так і не вийшов із черги транспорту» (черга переповнена / закрита). Це не збій постачальника:
 * запобіжник не спрацьовує, тривоги `provider-failover` немає; лист постачальнику не передавався (без дубля).
 */
export const MAIL_QUEUE_OVERFLOW = 'EQUEUE';

export interface MailTransport {
  send(msg: MailMessage): Promise<MailTransportResult>;
  /** Скільки листів чекає в черзі транспорту (ще не передані постачальнику). Без методу — 0. */
  backlog?(): number;
}

export type MailSendResult =
  | { readonly ok: true; readonly provider: string }
  | { readonly ok: false; readonly reason: 'recipient' | 'unavailable' };

/** Лічильники доби UTC постачальника: надіслано й добова стеля (AC-46). */
export interface MailProviderCount {
  readonly sent: number;
  readonly ceiling: number;
}

export interface MailCountsToday {
  readonly primary: MailProviderCount;
  readonly fallback: MailProviderCount;
}

export interface MailService {
  send(msg: MailMessage): Promise<MailSendResult>;
  /** Лічильники листів за поточну добу UTC (рядок «Листи» моніторингу). Необов'язковий для підмінних сервісів тестів. */
  countsToday?(): Promise<MailCountsToday>;
}
