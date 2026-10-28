/**
 * Набір емоцій «Першого ряду» (O-EMOJI, рішення 2026-10-28): 16 емодзі як на макетах `Phone-Emoji` / `Phone-Chat-FirstRow`.
 * Назви — `windows.emoji.names.<id>`. Старі ідентифікатори (з localStorage й давніх сидів) приводяться до найближчих нових.
 */
export const EMOTIONS = [
  { id: 'glasses', symbol: '🥂' },
  { id: 'confetti', symbol: '🎉' },
  { id: 'fireworks', symbol: '🎆' },
  { id: 'sparkles', symbol: '✨' },
  { id: 'heart', symbol: '❤️' },
  { id: 'champagne', symbol: '🍾' },
  { id: 'party', symbol: '🥳' },
  { id: 'star', symbol: '🌟' },
  { id: 'sparkler', symbol: '🎇' },
  { id: 'tree', symbol: '🎄' },
  { id: 'gift', symbol: '🎁' },
  { id: 'balloon', symbol: '🎈' },
  { id: 'hug', symbol: '🤗' },
  { id: 'joy', symbol: '😄' },
  { id: 'snowflake', symbol: '❄️' },
  { id: 'clock', symbol: '🕛' },
] as const;

export type EmotionId = (typeof EMOTIONS)[number]['id'];

export const EMOTION_IDS: readonly EmotionId[] = EMOTIONS.map((e) => e.id);
export const DEFAULT_EMOTION: EmotionId = 'glasses';

/** Старі ідентифікатори → найближчі з нового набору. */
const LEGACY: Record<string, EmotionId> = {
  hat: 'party',
  smile: 'joy',
  tears: 'joy',
  laugh: 'joy',
  dance: 'party',
  fire: 'fireworks',
  peace: 'sparkles',
  clap: 'confetti',
};

/** Ідентифікатор із нового набору (старі й невідомі — найближчий або «Іскри»). */
export function canonicalEmotion(id: string | undefined): EmotionId {
  if (!id) return DEFAULT_EMOTION;
  if ((EMOTION_IDS as readonly string[]).includes(id)) return id as EmotionId;
  return LEGACY[id] ?? 'sparkles';
}

export function emotionSymbol(id: string | undefined): string {
  const c = canonicalEmotion(id);
  return EMOTIONS.find((e) => e.id === c)!.symbol;
}
