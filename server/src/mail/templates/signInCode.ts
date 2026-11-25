/** Лист із кодом входу (SPEC-10 AC-36): українською, без посилань. */
import type { MailMessage } from '../ports';

export interface SignInCodeInput {
  readonly code: string;
  readonly id: string;
  readonly from: string;
  /** Адресат; сервіс може підставити його сам. */
  readonly to?: string;
}

const DOMAIN = 'mail.time2fest.com';

export function signInCodeMail(input: SignInCodeInput): MailMessage {
  const { code, id } = input;
  const text = [
    `Ваш код входу в Time2Fest: ${code}`,
    '',
    'Код дійсний 10 хвилин.',
    'Якщо це не ви — проігноруйте цей лист.',
  ].join('\n');
  const html =
    '<!doctype html><html lang="uk"><body style="font-family:Arial,sans-serif">' +
    '<p>Ваш код входу в Time2Fest:</p>' +
    `<p style="font-size:28px;letter-spacing:4px"><strong>${code}</strong></p>` +
    '<p>Код дійсний 10 хвилин.</p>' +
    '<p>Якщо це не ви — проігноруйте цей лист.</p></body></html>';
  return {
    id,
    to: input.to ?? '',
    subject: `Ваш код входу в Time2Fest: ${code}`,
    text,
    html,
    class: 'code',
    headers: {
      From: input.from,
      'Auto-Submitted': 'auto-generated',
      'Resend-Idempotency-Key': id,
      'X-Entity-Ref-ID': id,
      'Message-ID': `<${id}@${DOMAIN}>`,
    },
  };
}
