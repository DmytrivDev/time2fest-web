/**
 * Фільтр ключів для будь-якої майбутньої копії Redis (SPEC-13b AC-49), ring 1 — чиста функція.
 *
 * Redis зараз не копіюється взагалі. Якщо копія колись з'явиться, денна сіль відбитків
 * (`<prefix>edge:salt:<UTC день>`, `platform/fingerprint.ts`) не має потрапити в неї ніколи: правило
 * `*edge:salt:*` — будь-який ключ, що містить `edge:salt:`, незалежно від префікса.
 */
const EXCLUDED = /edge:salt:/;

/** true — ключ можна копіювати; false — ключ виключено з копії. */
export function redisCopyFilter(key: string): boolean {
  return !EXCLUDED.test(key);
}
