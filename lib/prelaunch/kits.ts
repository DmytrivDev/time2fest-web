/**
 * Набори «країна + пояс» (конвеєр «Країни», `docs/site/country-kit.md`) у передстартовому сайті: ключ одиниці, іконки
 * традицій, сцени з файлів.
 */
import type { IconName } from '@/components/primitives/Icon';
import scenesJson from '@/content/prelaunch/scenes/index.json';

/** Ключ одиниці: `JP` (країна з одним поясом чи головний пояс) або `BR@utc-0400` (інший пояс багатопоясної країни). */
export const unitKey = (iso: string, zoneId: string) => `${iso}@${zoneId}`;

/** Іконки традицій наборів (13 від конвеєра, `Icon.tsx`; `sun` — перший схід сонця, KR і TW). Невідома — `undefined`: наявний словник `HowToCard`. */
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
  sun: 'tradition-sun',
  door: 'tradition-door',
  grapes: 'tradition-grapes',
  suitcase: 'tradition-suitcase',
};

export function kitIcon(iconId: string | undefined): IconName | undefined {
  return iconId ? KIT_ICONS[iconId] : undefined;
}

/**
 * Запис сцени в `index.json`: шлях (сцена 3:2), шлях із точкою фокусу (`position`, % кадру, як `object-position`) або
 * широка сцена 480×200 (`wide: true`; `sky` і `water` — кольори неба й води для вузької рамки, де під і над зоною листівки
 * лишається місце).
 */
export type SceneEntry =
  | string
  | { src: string; position?: { x: number; y: number }; wide?: false }
  | { src: string; wide: true; sky?: string; water?: string };

/** Сцени з файлів (`content/prelaunch/scenes/index.json`, збірка кладе їх у `/scenes/`). */
const SCENES = (scenesJson as { scenes: Record<string, SceneEntry> }).scenes;

/**
 * Типовий фокус сцени — верх по центру: рамка сцени ширша за 3:2 (на десктопі ≈ 2,15:1), і обрізка по центру зрізала б
 * верхівку пам'ятки; знизу сцени — земля, її не шкода.
 */
export const SCENE_FOCUS_DEFAULT = { x: 50, y: 0 } as const;

export interface SceneFile {
  src: string;
  /** Для `object-position`, напр. `50% 0%` (лише сцена 3:2). */
  position: string;
  /** Широка сцена 480×200: кадрування за правим краєм (`WideSceneArt`), кольори тла для вузької рамки. */
  wide?: { sky?: string; water?: string };
}

/**
 * Сцена одиниці з файла: спершу поясу (`BR@utc-0400`), для головного поясу — і країни (`JP`). Немає — `undefined`
 * (тоді вбудована сцена `PostcardArt`, якщо є, або сторінка без сцени).
 */
export function sceneFile(iso: string, zoneId: string, mainZone: boolean): SceneFile | undefined {
  const entry = SCENES[unitKey(iso, zoneId)] ?? (mainZone ? SCENES[iso] : undefined);
  return entry ? sceneOf(entry) : undefined;
}

/** Запис `index.json` → сцена для сторінки (окремо — для тестів формату). */
export function sceneOf(entry: SceneEntry): SceneFile {
  if (typeof entry !== 'string' && entry.wide) {
    return {
      src: entry.src,
      position: 'right center',
      wide: {
        ...(entry.sky ? { sky: entry.sky } : {}),
        ...(entry.water ? { water: entry.water } : {}),
      },
    };
  }
  const { src, position } = typeof entry === 'string' ? { src: entry, position: undefined } : entry;
  const p = position ?? SCENE_FOCUS_DEFAULT;
  return { src, position: `${p.x}% ${p.y}%` };
}
