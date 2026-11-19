/**
 * Набори «країна + пояс» (конвеєр «Країни», `docs/site/country-kit.md`) у передстартовому сайті: ключ одиниці, іконки
 * традицій, сцени з файлів.
 */
import type { IconName } from '@/components/primitives/Icon';
import scenesJson from '@/content/prelaunch/scenes/index.json';

/** Ключ одиниці: `JP` (країна з одним поясом чи головний пояс) або `BR@utc-0400` (інший пояс багатопоясної країни). */
export const unitKey = (iso: string, zoneId: string) => `${iso}@${zoneId}`;

/** Іконки традицій наборів (12 від конвеєра, `Icon.tsx`). Невідома — `undefined`: наявний словник `HowToCard`. */
const KIT_ICONS: Readonly<Record<string, IconName>> = {
  bell: 'tradition-bell',
  noodles: 'tradition-noodles',
  shrine: 'tradition-shrine',
  address: 'tradition-address',
  feast: 'tradition-feast',
  tree: 'tradition-tree',
  white: 'tradition-white',
  flower: 'tradition-flower',
  wave: 'tradition-wave',
  fireworks: 'tradition-fireworks',
  boat: 'tradition-boat',
  music: 'tradition-music',
};

export function kitIcon(iconId: string | undefined): IconName | undefined {
  return iconId ? KIT_ICONS[iconId] : undefined;
}

/** Запис сцени в `index.json`: шлях або шлях із точкою фокусу (`position`, % кадру, як `object-position`). */
type SceneEntry = string | { src: string; position?: { x: number; y: number } };

/** Сцени з файлів (`content/prelaunch/scenes/index.json`, збірка кладе їх у `/scenes/`). */
const SCENES = (scenesJson as { scenes: Record<string, SceneEntry> }).scenes;

/**
 * Типовий фокус сцени — верх по центру: рамка сцени ширша за 3:2 (на десктопі ≈ 2,15:1), і обрізка по центру зрізала б
 * верхівку пам'ятки; знизу сцени — земля, її не шкода.
 */
export const SCENE_FOCUS_DEFAULT = { x: 50, y: 0 } as const;

export interface SceneFile {
  src: string;
  /** Для `object-position`, напр. `50% 0%`. */
  position: string;
}

/**
 * Сцена одиниці з файла: спершу поясу (`BR@utc-0400`), для головного поясу — і країни (`JP`). Немає — `undefined`
 * (тоді вбудована сцена `PostcardArt`, якщо є, або сторінка без сцени).
 */
export function sceneFile(iso: string, zoneId: string, mainZone: boolean): SceneFile | undefined {
  const entry = SCENES[unitKey(iso, zoneId)] ?? (mainZone ? SCENES[iso] : undefined);
  if (!entry) return undefined;
  const { src, position } = typeof entry === 'string' ? { src: entry, position: undefined } : entry;
  const p = position ?? SCENE_FOCUS_DEFAULT;
  return { src, position: `${p.x}% ${p.y}%` };
}
