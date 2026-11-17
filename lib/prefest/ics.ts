/**
 * «Додати в календар» на головній «до свята»: файл події `.ics` (RFC 5545), без бекенду й без сторонніх сервісів.
 * Час — у UTC (`…Z`), тож календар сам покаже його за часом відвідувача.
 */
import type { Ms } from '@/lib/data/types';

export interface CalendarEvent {
  /** Стабільний ідентифікатор (той самий файл — та сама подія в календарі). */
  uid: string;
  title: string;
  description?: string;
  startMs: Ms;
  /** Тривалість, хв (за замовчуванням 30). */
  minutes?: number;
  url?: string;
}

const SITE_URL = 'https://time2fest.com/';

function stamp(ms: Ms): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Екранування тексту за RFC 5545 (3.3.11). */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buildIcs(event: CalendarEvent, nowMs: Ms = Date.now()): string {
  const end = event.startMs + (event.minutes ?? 30) * 60_000;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Time2Fest//Prefest//UK',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}@time2fest.com`,
    `DTSTAMP:${stamp(nowMs)}`,
    `DTSTART:${stamp(event.startMs)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    `URL:${event.url ?? SITE_URL}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(event.title)}`,
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Завантажити подію файлом (браузер сам запропонує календар). */
export function downloadIcs(event: CalendarEvent, fileName = 'time2fest.ics'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
