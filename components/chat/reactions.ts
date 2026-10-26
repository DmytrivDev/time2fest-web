import type { ReactionId } from '@/lib/data/types';

/** Шість реакцій (C12): символ візуальний, назва — у `chat.reactions.<id>`. */
export const REACTION_SYMBOLS: Record<ReactionId, string> = {
  clap: '🎉',
  heart: '❤️',
  glasses: '🥂',
  fireworks: '🎆',
  laugh: '😂',
  hug: '🤗',
};

export const REACTION_ORDER: readonly ReactionId[] = ['clap', 'heart', 'glasses', 'fireworks', 'laugh', 'hug'];
