import { PlayerSlot } from '@/components/player/PlayerSlot';

/**
 * Головна (ефір) — тимчасова заглушка, щоб LiveShell рендерився.
 * TODO(US1 T068+): PlayerBlock(`broadcast`), FirstRowStrip, InFlowSlot, вкладки «Події | Чат».
 */
export default function LivePage() {
  return (
    <>
      {/* Один прихований h1 на сторінку (ІНВ 5.6). TODO(i18n): «Новий рік наживо — <Місто>». */}
      <h1 className="sr-only">Новий рік наживо</h1>
      <PlayerSlot
        fallback={
          <div className="flex size-full items-center justify-center p-4 text-center text-body text-text-muted">
            Тут буде трансляція
          </div>
        }
      />
    </>
  );
}
