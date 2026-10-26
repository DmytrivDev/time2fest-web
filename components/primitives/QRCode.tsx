import { QRCodeSVG } from 'qrcode.react';
import { cn } from './cn';

export interface QRCodeProps {
  /** Повна адреса, яку кодуємо. */
  value: string;
  /** Коротка видима адреса під кодом («time2fest.com/r/ab12»). Обов'язкова: під кожним QR-кодом є видимий URL. */
  shortUrl: string;
  /** `alt`: куди веде код («QR-код: оцінити шоу Лондона на телефоні»). */
  alt: string;
  /** Розмір коду в px; на ТВ більший. */
  size?: 128 | 160 | 192 | 256;
  /** ТВ: більший підпис. */
  tv?: boolean;
  className?: string;
}

/** P30. QR-код (SVG) із видимою короткою адресою під ним. Світлий фон потрібен для зчитування камерою. */
export function QRCode({ value, shortUrl, alt, size = 160, tv = false, className }: QRCodeProps) {
  return (
    <figure className={cn('inline-flex flex-col items-center gap-2', className)}>
      <span className="rounded-md bg-text p-2">
        <QRCodeSVG
          value={value}
          size={size}
          level="M"
          fgColor="var(--color-background)"
          bgColor="var(--color-text)"
          role="img"
          aria-label={alt}
        />
      </span>
      <figcaption className={cn('break-all text-center text-text-secondary', tv ? 'text-tv-text' : 'text-caption')}>{shortUrl}</figcaption>
    </figure>
  );
}
