import en from '@/messages/en.json';
import es from '@/messages/es.json';
import fr from '@/messages/fr.json';
import uk from '@/messages/uk.json';
import type { Locale } from '@/i18n/locales';
import { localeMessages, type MessageTree } from './messageSet.mjs';

const FILES = { uk, en, es, fr } as unknown as Record<string, MessageTree>;
const cache = new Map<Locale, MessageTree>();

/** Тексти мовного дерева мовою `locale` (чого бракує — англійською, далі українською). Лише на сервері й під час збирання. */
export function prelaunchMessages(locale: Locale): MessageTree {
  let m = cache.get(locale);
  if (!m) {
    m = localeMessages(locale, FILES);
    cache.set(locale, m);
  }
  return m;
}

/** Те саме без метаданих сторінок: їх читає лише сервер, у браузер вони не їдуть. */
export function clientMessages(locale: Locale): MessageTree {
  const all = prelaunchMessages(locale);
  const prelaunch = { ...((all.prelaunch ?? {}) as MessageTree) };
  delete prelaunch.meta;
  return { ...all, prelaunch };
}
