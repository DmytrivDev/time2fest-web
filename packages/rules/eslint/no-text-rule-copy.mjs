// Перевірка дублювання правил тексту (SPEC-09, AC-3): поза `packages/rules` не можна копіювати вирази перевірки
// посилань і контактів, слова фільтра чи ліміти довжини. Бери їх із `@time2fest/rules/text`.
//
// Лок-степ: таблиці нижче мають збігатися з експортами `packages/rules/src/text/*`
// (`links.ts` LINK_RE/TLDS, `toast.ts` EMAIL/PHONE/HANDLE/TOAST_WORDS, `nick.ts` NICK_SERVICE_WORDS,
// `extended-words.ts` EXTENDED_WORDS, `limits.ts`) — перевіряє tests/unit/lint/text-rules-lint.test.ts.
// Контрольне слово `zqxfallbackctl7` — частина розширеного списку; воно ж є підписом у `scripts/check-bundle.mjs`.

const TLDS =
  'com|net|org|info|io|me|ua|ru|de|uk|fr|es|pl|co|tv|ly|gl|gg|app|dev|xyz|biz|site|online|link|club|top|shop|store|cc|nl|ch|eu|us|ca|au|jp|cn|br|tk|ml|ws';

/** `source` виразів правил (з `\/` як у `RegExp.source`; порівняння нормалізує скісну риску). */
export const RULE_REGEX_SOURCES = Object.freeze({
  LINK_RE: String.raw`(?:https?:\/\/|www\.|(?:^|[^\p{L}\d@-])[a-z\d-]+(?:\.[a-z\d-]+)*\.(?:${TLDS})(?![\p{L}\d]))`,
  EMAIL: String.raw`[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}`,
  PHONE: String.raw`\+?\d[\d\s()-]{7,}\d`,
  HANDLE: String.raw`(?:^|[^\p{L}\d])(@[\p{L}\d_.]{3,})`,
});

/** Слова фільтра тосту ∪ службові слова ніка ∪ розширений запасний список. */
export const RULE_WORDS = Object.freeze([
  'хуй', 'хуя', 'хує', 'пизд', 'їбан', 'йоб', 'єба', 'ебат', 'ебан', 'бляд', 'сука', 'суки', 'fuck', 'shit', 'bitch', 'cunt', 'dick',
  'admin', 'moderator', 'time2fest', 'адмін', 'модератор', 'підтримка', 'support',
  'довбойоб', 'підар', 'пидар', 'гондон', 'мудак', 'шлюх', 'залуп', 'курв', 'пердол', 'мразот', 'уйоб',
  'сволоч', 'ублюд', 'дерьм', 'говн', 'жопа', 'ебал', 'пиздец', 'хуев', 'мудил',
  'asshole', 'bastard', 'motherfuck', 'whore', 'slut', 'nigger', 'faggot', 'retard', 'wanker', 'twat',
  'zqxfallbackctl7',
]);

/** Ліміти довжини (`limits.ts`): ім'я → значення. Те саме ім'я з іншим числом — чужий ліміт, не копія. */
export const LIMIT_VALUES = Object.freeze({ MAX_TEXT: 200, NICK_MIN: 2, NICK_MAX: 20, TOAST_MAX: 120 });
export const LIMIT_NAMES = Object.freeze(Object.keys(LIMIT_VALUES));

const norm = (s) => s.replace(/\\\//g, '/');
const SOURCES = new Set(Object.values(RULE_REGEX_SOURCES).map(norm));
const WORDS = new Set(RULE_WORDS);

function unwrap(node) {
  let n = node;
  while (n && (n.type === 'TSNonNullExpression' || n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion')) {
    n = n.expression;
  }
  return n;
}

const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      regex: 'Вираз правила тексту скопійовано вручну — бери з @time2fest/rules/text (SPEC-09).',
      words: 'Список слів правила тексту скопійовано вручну — бери з @time2fest/rules/text (SPEC-09).',
      limit: 'Ліміт довжини тексту скопійовано вручну — бери з @time2fest/rules/text (SPEC-09).',
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (node.regex && SOURCES.has(norm(node.regex.pattern))) context.report({ node, messageId: 'regex' });
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'RegExp') return;
        const arg = node.arguments[0];
        if (!arg) return;
        const text =
          arg.type === 'Literal' && typeof arg.value === 'string'
            ? arg.value
            : arg.type === 'TemplateLiteral' && arg.expressions.length === 0
              ? arg.quasis[0].value.cooked
              : null;
        if (text !== null && SOURCES.has(norm(text))) context.report({ node, messageId: 'regex' });
      },
      ArrayExpression(node) {
        const hits = node.elements.filter((e) => e && e.type === 'Literal' && typeof e.value === 'string' && WORDS.has(e.value));
        if (hits.length >= 2) context.report({ node, messageId: 'words' });
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !LIMIT_NAMES.includes(node.id.name)) return;
        const init = unwrap(node.init);
        if (init && init.type === 'Literal' && init.value === LIMIT_VALUES[node.id.name]) context.report({ node, messageId: 'limit' });
      },
    };
  },
};

const plugin = {
  meta: { name: 't2f-text' },
  rules: { 'no-rule-copy': rule },
};

export default plugin;
