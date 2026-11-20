/**
 * Рівні тосту — головний платний продукт (рішення власника 2026-11-12, дошки `Desk-Toast-New`, `Phone-Toast-New` v2):
 * $2 «келих» — золотий тост у чаті «Світ»; $5 «пляшка ігристого» (за замовчуванням) — те саме + закріплений під
 * трансляцією до наступної півночі; $10 «феєрверк» — те саме + нік у привітанні опівночі + Новорічний пас у подарунок
 * (у кого пас уже є — «Новорічний пас у тебе вже є»). Тост доступний усім і завжди, зокрема власникам пасу.
 */
export const TOAST_TIERS = [2, 5, 10] as const;
export type ToastTier = (typeof TOAST_TIERS)[number];
export const DEFAULT_TIER: ToastTier = 5;

/** Найдовший тост — правило в `packages/rules/src/text/limits.ts` (SPEC-09). */
export { TOAST_MAX } from '@time2fest/rules/text';

/** З якого рівня тост закріплено під трансляцією до наступної півночі. */
export const PIN_FROM: ToastTier = 5;
/** З якого рівня нік — у привітанні опівночі. */
export const GREETING_FROM: ToastTier = 10;
/** З якого рівня — Новорічний пас у подарунок. */
export const PASS_GIFT_FROM: ToastTier = 10;

export const isToastTier = (v: unknown): v is ToastTier => (TOAST_TIERS as readonly unknown[]).includes(v);

export const tierPins = (tier: number): boolean => tier >= PIN_FROM;
export const tierGreets = (tier: number): boolean => tier >= GREETING_FROM;
export const tierGiftsPass = (tier: number): boolean => tier >= PASS_GIFT_FROM;

export type BenefitKey = 'gold' | 'pinned' | 'greeting' | 'pass';

export interface Benefit {
  key: BenefitKey;
  /** Рівень, з якого пункт діє. */
  from: ToastTier;
  /** Обраний рівень дає цей пункт. */
  included: boolean;
  /** Пас уже є — замість подарунка рядок «Новорічний пас у тебе вже є» (без галочки й «з $10»). */
  owned?: boolean;
}

const BENEFITS: readonly { key: BenefitKey; from: ToastTier }[] = [
  { key: 'gold', from: 2 },
  { key: 'pinned', from: PIN_FROM },
  { key: 'greeting', from: GREETING_FROM },
  { key: 'pass', from: PASS_GIFT_FROM },
];

/** Що дає обраний рівень: усі чотири пункти, увімкнені — з галочкою, решта — сірі з «з $N». */
export function tierBenefits(tier: ToastTier, hasPass: boolean): Benefit[] {
  return BENEFITS.map(({ key, from }) =>
    key === 'pass' && hasPass ? { key, from, included: false, owned: true } : { key, from, included: tier >= from },
  );
}
