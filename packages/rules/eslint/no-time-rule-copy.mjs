// Перевірка дублювання правил часу (SPEC-03, AC-5): поза `packages/rules` не можна додавати до моменту
// півночі (`midnightMs`, `midnight`, `m`, `t0`, `midnightOf(…)`) часову константу правила чи власну константу з тим
// самим значенням межі. Межу бери функцією з `@time2fest/rules/time`.
//
// Лок-степ: імена й значення нижче мають збігатися з усіма експортованими константами
// `packages/rules/src/time/constants.ts`, крім `SERVER_CLOCK_TOLERANCE_MS` (перевіряє tests/unit/lint/time-rules-lint.test.ts).

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;

const RULE_CONSTANTS = Object.freeze({
  HOWTO_BEFORE: 15 * MIN,
  STAMP_DELAY: 15 * SEC,
  RATE_OPEN_AFTER: 5 * MIN,
  RATE_DURATION: 3 * MIN,
  OFFER_MIN_AFTER: 5 * MIN,
  OFFER_MIN_BEFORE_NEXT: 10 * MIN,
  HANDOVER_AFTER: 15 * MIN,
  LAST_MINUTE_FROM: 14 * MIN,
  RECORDING_AFTER: 30 * MIN,
  DELAY_NOTICE_FROM: 5 * MIN,
  CELEBRATION_LEAD: 2 * HOUR,
  CELEBRATION_TAIL: 2 * HOUR,
  RATING_OPEN_AFTER: 15 * SEC,
  RATING_CLOSE_AFTER: 12 * HOUR,
  SCHEDULE_CLOSE_MS: 2 * MIN,
  CATCH_UP_MAX_AGE_MS: 30 * MIN,
  POLL_WINDOW_BEFORE: 60 * MIN,
  POLL_WINDOW_AFTER: 60 * MIN,
});

/** Імена експортованих констант правил (усі з `constants.ts`, крім `SERVER_CLOCK_TOLERANCE_MS`). */
export const RULE_CONSTANT_NAMES = Object.freeze(Object.keys(RULE_CONSTANTS));
/** Значення меж цих констант. */
export const BOUNDARY_VALUES = new Set(Object.values(RULE_CONSTANTS));

const MOMENT_NAMES = new Set(['midnightMs', 'midnight', 'm', 't0']);
const RELATIONAL = new Set(['<', '<=', '>', '>=']);
const MAX_DEPTH = 8;

function unwrap(node) {
  let n = node;
  while (n && (n.type === 'TSNonNullExpression' || n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'TSTypeAssertion')) {
    n = n.expression;
  }
  return n;
}

function propertyName(node) {
  if (node.type !== 'MemberExpression' || node.computed) return null;
  return node.property.type === 'Identifier' ? node.property.name : null;
}

/** Момент: `midnightMs`, `zone.midnightMs`, `midnight`, `m`, `t0` або виклик `midnightOf(…)`. */
function isMoment(node) {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'Identifier') return MOMENT_NAMES.has(n.name);
  if (n.type === 'MemberExpression') return MOMENT_NAMES.has(propertyName(n) ?? '');
  if (n.type === 'ChainExpression') return isMoment(n.expression);
  if (n.type === 'CallExpression') {
    const callee = unwrap(n.callee);
    return (callee.type === 'Identifier' && callee.name === 'midnightOf') || propertyName(callee) === 'midnightOf';
  }
  return false;
}

/** `+`/`-`-вираз, у якому десь бере участь момент. */
function involvesMoment(node) {
  const n = unwrap(node);
  if (!n || n.type !== 'BinaryExpression' || (n.operator !== '+' && n.operator !== '-')) return false;
  const side = (s) => isMoment(s) || involvesMoment(s);
  return side(n.left) || side(n.right);
}

function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return null;
}

/** Статичне значення: числові літерали, унарний мінус/плюс, `*` таких значень, `const` цього ж модуля. */
function staticValue(node, scope, depth = 0) {
  const n = unwrap(node);
  if (!n || depth > MAX_DEPTH) return undefined;
  switch (n.type) {
    case 'Literal':
      return typeof n.value === 'number' ? n.value : undefined;
    case 'UnaryExpression': {
      if (n.operator !== '-' && n.operator !== '+') return undefined;
      const v = staticValue(n.argument, scope, depth + 1);
      return v === undefined ? undefined : n.operator === '-' ? -v : v;
    }
    case 'BinaryExpression': {
      if (n.operator !== '*') return undefined;
      const a = staticValue(n.left, scope, depth + 1);
      const b = staticValue(n.right, scope, depth + 1);
      return a === undefined || b === undefined ? undefined : a * b;
    }
    case 'Identifier': {
      const v = findVariable(scope, n.name);
      const def = v?.defs[0];
      if (!def || def.type !== 'Variable' || def.parent?.kind !== 'const' || !def.node.init) return undefined;
      return staticValue(def.node.init, scope, depth + 1);
    }
    default:
      return undefined;
  }
}

/** Константа правила за іменем або значенням межі. */
function isRuleBound(node, scope) {
  const n = unwrap(node);
  if (!n) return false;
  if (n.type === 'Identifier' && RULE_CONSTANT_NAMES.includes(n.name)) return true;
  const prop = propertyName(n);
  if (prop && RULE_CONSTANT_NAMES.includes(prop)) return true;
  const v = staticValue(n, scope);
  return v !== undefined && BOUNDARY_VALUES.has(Math.abs(v));
}

const rule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      copy: 'Межа правила часу скопійована вручну — бери функцію з @time2fest/rules/time (SPEC-03).',
    },
  },
  create(context) {
    const scopeOf = (node) => context.sourceCode.getScope(node);
    return {
      BinaryExpression(node) {
        const scope = scopeOf(node);
        if (node.operator === '+') {
          if ((isMoment(node.left) && isRuleBound(node.right, scope)) || (isMoment(node.right) && isRuleBound(node.left, scope))) {
            context.report({ node, messageId: 'copy' });
          }
          return;
        }
        if (node.operator === '-') {
          if (isMoment(node.left) && isRuleBound(node.right, scope)) context.report({ node, messageId: 'copy' });
          return;
        }
        if (RELATIONAL.has(node.operator)) {
          if ((involvesMoment(node.left) && isRuleBound(node.right, scope)) || (involvesMoment(node.right) && isRuleBound(node.left, scope))) {
            context.report({ node, messageId: 'copy' });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 't2f-time' },
  rules: { 'no-rule-copy': rule },
};

export default plugin;
