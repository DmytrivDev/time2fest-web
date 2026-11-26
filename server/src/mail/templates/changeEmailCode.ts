/** Лист із кодом зміни пошти (SPEC-11 W31, AC-43): на нову адресу, українською, без посилань. */
import type { MailMessage } from '../ports';

export interface ChangeEmailCodeInput {
  readonly code: string;
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

const DOMAIN = 'mail.time2fest.com';

export function changeEmailCodeMail(input: ChangeEmailCodeInput): MailMessage {
  const { code, id } = input;
  const text = [
    `Код підтвердження нової пошти в Time2Fest: ${code}`,
    '',
    'Введіть його в кабінеті, щоб змінити пошту акаунта на цю адресу.',
    'Код дійсний 10 хвилин.',
    'Якщо це не ви — проігноруйте цей лист, пошта акаунта не зміниться.',
  ].join('\n');
  const html =
    '<!doctype html><html lang="uk"><body style="font-family:Arial,sans-serif">' +
    '<p>Код підтвердження нової пошти в Time2Fest:</p>' +
    `<p style="font-size:28px;letter-spacing:4px"><strong>${code}</strong></p>` +
    '<p>Введіть його в кабінеті, щоб змінити пошту акаунта на цю адресу.</p>' +
    '<p>Код дійсний 10 хвилин.</p>' +
    '<p>Якщо це не ви — проігноруйте цей лист, пошта акаунта не зміниться.</p></body></html>';
  return {
    id,
    to: input.to,
    subject: `Код зміни пошти в Time2Fest: ${code}`,
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
