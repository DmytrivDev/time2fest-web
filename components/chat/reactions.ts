import type { ReactionId } from '@/lib/data/types';

/** Реакції (C12): символ візуальний, назва — у `chat.reactions.<id>`. Перші шість — із сітки меню й симулятора, `hug` лишився зі старих даних. */
export const REACTION_SYMBOLS: Record<ReactionId, string> = {
  clap: '🎉',
  glasses: '🥂',
  heart: '❤️',
  fireworks: '🎆',
  party: '🥳',
  champagne: '🍾',
  sparkles: '✨',
  pray: '🙏',
  laugh: '😂',
  loveeyes: '😍',
  fire: '🔥',
  applause: '👏',
  starstruck: '🤩',
  smile: '😊',
  sad: '😢',
  tree: '🎄',
  thumbs: '👍',
  raised: '🙌',
  dancer: '💃',
  dancing: '🕺',
  gift: '🎁',
  star: '⭐',
  earth: '🌍',
  yellowheart: '💛',
  hug: '🤗',
};

/** Сітка меню «⋯» 3×8 — рівно набір макета `Desk-Chat-MessageMenu`. */
export const MENU_REACTION_ROWS: readonly (readonly ReactionId[])[] = [
  ['clap', 'glasses', 'heart', 'fireworks', 'party', 'champagne', 'sparkles', 'pray'],
  ['laugh', 'loveeyes', 'fire', 'applause', 'starstruck', 'smile', 'sad', 'tree'],
  ['thumbs', 'raised', 'dancer', 'dancing', 'gift', 'star', 'earth', 'yellowheart'],
];

/** Шість реакцій панелі автора (O-AUTHOR). */
export const REACTION_ORDER: readonly ReactionId[] = ['clap', 'heart', 'glasses', 'fireworks', 'laugh', 'hug'];

/** Порядок чипів під повідомленням: усі реакції. */
export const REACTION_DISPLAY_ORDER: readonly ReactionId[] = [...MENU_REACTION_ROWS.flat(), 'hug'];
