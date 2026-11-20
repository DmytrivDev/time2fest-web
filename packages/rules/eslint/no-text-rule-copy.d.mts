/** `source` виразів правил тексту (LINK_RE, EMAIL, PHONE, HANDLE). */
export declare const RULE_REGEX_SOURCES: Readonly<Record<'LINK_RE' | 'EMAIL' | 'PHONE' | 'HANDLE', string>>;
/** Слова фільтра тосту, службові слова ніка й розширений запасний список. */
export declare const RULE_WORDS: readonly string[];
/** Ліміти довжини: ім'я → значення. */
export declare const LIMIT_VALUES: Readonly<Record<'MAX_TEXT' | 'NICK_MIN' | 'NICK_MAX' | 'TOAST_MAX', number>>;
/** Імена лімітів довжини тексту. */
export declare const LIMIT_NAMES: readonly string[];

declare const plugin: import('eslint').ESLint.Plugin;
export default plugin;
