/** Поштові порти (SPEC-10 W17): один сервіс над двома SMTP-транспортами. */
export type MailClass = 'code' | 'other';

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

export interface MailSendError {
  readonly code?: string;
  readonly responseCode?: number;
  readonly command?: string;
  /** Лише для класифікації; не логувати й не зберігати. */
  readonly response?: string;
}

export type MailTransportResult = { readonly ok: true } | { readonly ok: false; readonly err: MailSendError };

export interface MailTransport {
  send(msg: MailMessage): Promise<MailTransportResult>;
}

export type MailSendResult =
  | { readonly ok: true; readonly provider: string }
  | { readonly ok: false; readonly reason: 'recipient' | 'unavailable' };

export interface MailService {
  send(msg: MailMessage): Promise<MailSendResult>;
}
