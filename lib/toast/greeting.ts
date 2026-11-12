/**
 * Привітання опівночі (рішення власника 2026-11-12, дошки `Desk-Toast-New` · «Північ · привітання», `Phone-Toast-New`):
 * системне повідомлення від «Time2Fest» о північ кожного поясу в чаті «Світ» і в чатах країн цього поясу —
 * «Північ · UTC+1 — з Новим роком!», країни поясу, «Тост цієї півночі піднімають:» і ніки з прапорами тих, хто сказав
 * тост на $10 до цієї півночі (`greetingToasters`). Ніхто не сказав — повідомлення без рядка тостів.
 */
import type { ChatMessage, Dataset, Ms, RoomId } from '@/lib/data/types';
import { messageId } from '@/lib/chat-sim/simulator';
import { greetingToasters, type ToastRecord } from './feed';

/** Країни поясу — найпопулярніші першими (у рядку привітання — перші три й «й ще N»). */
export function zoneCountryIsos(data: Pick<Dataset, 'countries'>, zoneId: string): string[] {
  return data.countries
    .filter((c) => c.zoneIds.includes(zoneId))
    .sort((a, b) => b.popularity - a.popularity || (a.iso < b.iso ? -1 : 1))
    .map((c) => c.iso);
}

/** Привітання північ, що настали в `(from, to]`, для кімнат `rooms`. */
export function toastGreetingMessages(
  data: Pick<Dataset, 'zones' | 'countries'>,
  rooms: readonly RoomId[],
  from: Ms,
  to: Ms,
  toasts: readonly ToastRecord[],
): ChatMessage[] {
  if (to <= from) return [];
  const out: ChatMessage[] = [];
  const zones = [...data.zones].sort((a, b) => a.midnightMs - b.midnightMs);
  zones.forEach((z, i) => {
    if (z.midnightMs <= from || z.midnightMs > to) return;
    const isos = zoneCountryIsos(data, z.id);
    const targets = rooms.filter((r) => r === 'world' || isos.includes(r.slice('country:'.length)));
    if (!targets.length) return;
    const prev = i > 0 ? zones[i - 1]!.midnightMs : null;
    const toasters = greetingToasters(toasts, z.midnightMs, prev);
    for (const room of targets) {
      out.push({
        id: messageId(z.midnightMs, 2_500, 0, room),
        room,
        kind: 'system',
        createdAt: z.midnightMs,
        system: { kind: 'toast-midnight', zoneId: z.id, offsetMinutes: z.offsetMinutes, countryIsos: isos, toasters },
        moderation: 'ok',
      });
    }
  });
  return out;
}
