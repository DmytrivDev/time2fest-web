/**
 * Модель повідомлення чату (шов, `docs/backend/frontend-seam.md`, E5a): детермінований id і порядок у стрічці.
 * Чисті функції — і для адаптера `sim`, і для майбутнього `http` (сервер присвоює id так само або свій).
 */
import type { ChatMessage, Ms } from '@/lib/data/types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(value: number, length: number): string {
  let out = '';
  let v = Math.max(0, Math.floor(value));
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[v % 32] + out;
    v = Math.floor(v / 32);
  }
  return out;
}

function hashRoom(room: string): number {
  let h = 0;
  for (let i = 0; i < room.length; i++) h = (h * 31 + room.charCodeAt(i)) % 1_048_576; // 32^4
  return h;
}

/**
 * Детермінований ULID-подібний id: 10 символів часу + 16 символів послідовності
 * (номер репліки в моменті, номер у сплеску/привітаннях, кімната). Той самий момент → той самий id.
 */
export function messageId(createdAt: Ms, offsetIndex: number, sub: number, room: string): string {
  return encodeBase32(createdAt, 10) + encodeBase32(offsetIndex, 4) + encodeBase32(sub, 4) + encodeBase32(0, 4) + encodeBase32(hashRoom(room), 4);
}

export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Видалене повідомлення: лишаються автор і час (для рядка «видалено»), вміст — ні. */
export function deletedCopy(m: ChatMessage): ChatMessage {
  return { id: m.id, room: m.room, kind: m.kind, createdAt: m.createdAt, author: m.author, moderation: m.moderation, deleted: true };
}
