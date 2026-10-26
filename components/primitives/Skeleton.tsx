import { cn } from './cn';

export type SkeletonVariant = 'block' | 'line' | 'circle' | 'player' | 'chat-line';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  className?: string;
}

/** Базова заливка з відблиском; відблиск вимкнено під «зменшити рух» (primitives.css). Прихований від зчитувача. */
const BASE = 't2f-shine relative overflow-hidden bg-surface';

/**
 * P21. Скелетон повторює розкладку блоку. Контейнер, що чекає, має `aria-busy="true"`,
 * а поруч — видимий або `sr-only` текст «Завантажуємо трансляцію».
 */
export function Skeleton({ variant = 'block', className }: SkeletonProps) {
  switch (variant) {
    case 'line':
      return <span aria-hidden="true" data-variant="line" className={cn(BASE, 'block h-4 w-full rounded-sm', className)} />;
    case 'circle':
      return <span aria-hidden="true" data-variant="circle" className={cn(BASE, 'block size-10 rounded-full', className)} />;
    case 'player':
      return (
        <span
          aria-hidden="true"
          data-variant="player"
          className={cn(BASE, 'block aspect-video min-h-player-min w-full', className)}
        />
      );
    case 'chat-line':
      return (
        <span aria-hidden="true" data-variant="chat-line" className={cn('flex items-start gap-3', className)}>
          <span className={cn(BASE, 'block size-8 shrink-0 rounded-full')} />
          <span className="flex flex-1 flex-col gap-2">
            <span className={cn(BASE, 'block h-3 w-1/3 rounded-sm')} />
            <span className={cn(BASE, 'block h-4 w-full rounded-sm')} />
          </span>
        </span>
      );
    case 'block':
    default:
      return <span aria-hidden="true" data-variant="block" className={cn(BASE, 'block h-24 w-full rounded-lg', className)} />;
  }
}
