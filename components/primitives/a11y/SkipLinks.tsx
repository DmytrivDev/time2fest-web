import { cn } from '../cn';

/** Цілі швидких переходів: ідентифікатори орієнтирів у LiveShell. */
export const SKIP_TARGETS = {
  content: 'main',
  chat: 'chat',
  map: 'map',
} as const;

export type SkipTarget = keyof typeof SKIP_TARGETS;

// TODO(i18n): перенести в messages/uk.json, коли з’явиться розділ shell.
const LABELS: Record<SkipTarget, string> = {
  content: 'Перейти до вмісту',
  chat: 'Перейти до чату',
  map: 'Перейти до мапи',
};

export interface SkipLinksProps {
  /** Лише ті цілі, що є на сторінці (без чату — без посилання на чат). */
  targets?: SkipTarget[];
  className?: string;
}

/**
 * P31. «Швидкі переходи»: перші в порядку Tab, видимі лише у фокусі.
 * «Перейти до вмісту / до чату / до мапи».
 */
export function SkipLinks({ targets = ['content', 'chat', 'map'], className }: SkipLinksProps) {
  return (
    <nav aria-label="Швидкі переходи" className={cn('t2f-skip-links', className)}>
      <ul className="m-0 list-none p-0">
        {targets.map((t) => (
          <li key={t}>
            <a
              href={`#${SKIP_TARGETS[t]}`}
              className="t2f-focus fixed left-2 top-2 z-50 -translate-y-24 rounded-md bg-surface-raised px-4 py-3 text-label-button text-text focus:translate-y-0"
            >
              {LABELS[t]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
