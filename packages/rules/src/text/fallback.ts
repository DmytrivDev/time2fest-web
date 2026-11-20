/**
 * Запасний фільтр сервера (С13): працює, коли обидва ШІ-провайдери недоступні. Чистий, синхронний: без мережі й таймерів.
 * Підшлях `@time2fest/rules/text/fallback` — навмисно НЕ реекспортується з `text/index.ts`, щоб розширений список не потрапив на сайт.
 */
import { EXTENDED_WORDS } from './extended-words';
import { EMAIL, HANDLE, PHONE } from './toast';
import { textRulesFor, type TextKind } from './rules';

export function fallbackVerdict(kind: TextKind, text: string): 'allow' | 'block' {
  if (textRulesFor(kind, text)) return 'block';
  if (kind === 'message' && (EMAIL.test(text) || PHONE.test(text) || HANDLE.test(text))) return 'block';
  const lower = text.toLowerCase();
  return EXTENDED_WORDS.some((w) => lower.includes(w)) ? 'block' : 'allow';
}
