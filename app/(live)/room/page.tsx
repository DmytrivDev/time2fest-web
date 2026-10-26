import type { Metadata } from 'next';
import { RoomLive } from '@/components/room/RoomLive';

/**
 * Кімната перегляду (S-ROOM, US3): склад — `components/room/RoomLive.tsx`.
 * Перехід сюди зі сторінки країни («+») — клієнтський у межах `(live)`: плеєр макета не перемонтовується,
 * відео, що грало, стає першим вікном (FR-042).
 */
export const metadata: Metadata = { title: 'Кімната перегляду — Новий рік наживо' };

export default function RoomPage() {
  return <RoomLive />;
}
