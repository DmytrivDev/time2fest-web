// Власне правило: заборона довільних значень Tailwind (`w-[13px]`, `bg-[#fff]`) у className.
// Причина: eslint-plugin-tailwindcss не підтримує Tailwind 4; всі значення мають іти з токенів.
const ARBITRARY = /(?:^|[\s"'`:])-?[a-z][\w-]*-\[[^\]\s]+\]/;

const rule = {
  meta: { type: 'problem', schema: [], messages: { arbitrary: 'Довільні значення Tailwind заборонені: використовуй токени ({{ value }}).' } },
  create(context) {
    const check = (node, text) => {
      const m = ARBITRARY.exec(text);
      if (m) context.report({ node, messageId: 'arbitrary', data: { value: m[0].trim() } });
    };
    return {
      JSXAttribute(node) {
        if (node.name.name !== 'className' || !node.value) return;
        if (node.value.type === 'Literal' && typeof node.value.value === 'string') check(node, node.value.value);
        if (node.value.type === 'JSXExpressionContainer') {
          const walk = (n) => {
            if (!n || typeof n !== 'object') return;
            if (n.type === 'Literal' && typeof n.value === 'string') check(n, n.value);
            else if (n.type === 'TemplateElement') check(n, n.value.raw);
            for (const key of Object.keys(n)) {
              if (key === 'parent') continue;
              const v = n[key];
              if (Array.isArray(v)) v.forEach(walk);
              else if (v && typeof v.type === 'string') walk(v);
            }
          };
          walk(node.value.expression);
        }
      },
    };
  },
};

const plugin = { rules: { 'no-arbitrary-tailwind': rule } };

export default plugin;
