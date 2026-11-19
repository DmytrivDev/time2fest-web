/**
 * Розширений список коренів для запасного фільтра сервера (AC-7…9). Лише для `@time2fest/rules/text/fallback`:
 * на сайт не потрапляє (перевіряє `scripts/check-bundle.mjs` за контрольним словом нижче).
 */
import { TOAST_WORDS } from './toast';

/** Контрольне слово: у репозиторії є лише тут, у перевірці збірки й її тесті. */
export const FALLBACK_CONTROL_WORD = 'zqxfallbackctl7';

const MORE_WORDS: readonly string[] = [
  // uk
  'довбойоб', 'підар', 'пидар', 'гондон', 'мудак', 'шлюх', 'залуп', 'курв', 'пердол', 'мразот', 'уйоб',
  // ru
  'сволоч', 'ублюд', 'дерьм', 'говн', 'жопа', 'ебал', 'пиздец', 'хуев', 'мудил',
  // en
  'asshole', 'bastard', 'motherfuck', 'whore', 'slut', 'nigger', 'faggot', 'retard', 'wanker', 'twat',
];

export const EXTENDED_WORDS: readonly string[] = [...new Set([...TOAST_WORDS, ...MORE_WORDS, FALLBACK_CONTROL_WORD])];
