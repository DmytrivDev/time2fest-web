/** Типи пошти, які потрібні чистим правилам ring 1 (SPEC-10 W17); `mail/ports.ts` їх реекспортує. */
export type MailClass = 'code' | 'other';

export interface MailSendError {
  readonly code?: string;
  readonly responseCode?: number;
  readonly command?: string;
  /** Лише для класифікації; не логувати й не зберігати. */
  readonly response?: string;
}
