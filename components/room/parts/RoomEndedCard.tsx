'use client';

/**
 * Вікно кімнати, чия трансляція закінчилась (правка власника 2026-11-15): замість кадру — «Трансляція завершилась» і
 * «Додати іншу». Кадр той самий 16:9; через `ENDED_CARD_MS` вікно зникає саме. Відео тут уже немає, тож це не накладка
 * на плеєр, що грає.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';

export function RoomEndedCard({ title, onAddOther }: { title: string; onAddOther: () => void }) {
  const t = useTranslations('room.window');
  return (
    <div
      data-room-ended=""
      role="status"
      className="relative flex aspect-video w-full min-h-player-min-height min-w-player-min-height flex-col items-center justify-center gap-3 overflow-hidden bg-surface px-4 text-center"
    >
      <Icon name="clock" size={24} className="text-text-secondary" />
      <p className="m-0 text-body font-semibold text-text">{t('ended')}</p>
      <p className="m-0 max-w-full truncate text-caption text-text-secondary">{title}</p>
      <Button variant="secondary" compact iconLeft="plus" onClick={onAddOther} data-action="room-ended-add">
        {t('endedAdd')}
      </Button>
    </div>
  );
}
