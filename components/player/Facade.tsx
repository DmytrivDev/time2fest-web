'use client';

/**
 * Facade — обкладинка відео до кліку (C1 `facade`, research.md 3 «Фасад»).
 * Для вікон кімнати 2–4 і ТВ: мініатюра `hqdefault.jpg` + кнопка; той самий кадр 16:9
 * і ті самі мінімальні розміри (200×200), що в плеєра. Мініатюра не є вбудованим плеєром,
 * звук не вмикається. `loading` (`l`) — скелетон `player`.
 */
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';

export interface FacadeProps {
  videoId: string;
  /** Назва джерела для людей («Лондон · Біг-Бен»); платформу не називаємо. */
  title: string;
  onActivate?: () => void;
  /** Плеєр уже вантажиться після кліку. */
  loading?: boolean;
  className?: string;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

const FRAME = 'relative aspect-video w-full min-h-player-min-height min-w-player-min-height overflow-hidden bg-surface';

export function Facade({ videoId, title, onActivate, loading = false, className }: FacadeProps) {
  if (loading) {
    // TODO(T053): замінити на <Skeleton variant="player" />, коли примітив з’явиться.
    return (
      <div className={cn(FRAME, 'bg-surface-raised', className)} role="status" aria-busy="true">
        <span className="sr-only">Завантаження трансляції: {title}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onActivate}
      data-facade=""
      className={cn(FRAME, 't2f-focus group block text-left', className)}
      aria-label={`Грати: ${title}`}
    >
      {/* Статичний експорт: next/image без оптимізації не дає переваг; мініатюра — звичайний img. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumbnailUrl(videoId)}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="t2f-transition inline-flex size-16 items-center justify-center rounded-full bg-scrim text-text group-hover:bg-surface-raised">
          <Icon name="play" size={22} />
        </span>
      </span>
    </button>
  );
}
