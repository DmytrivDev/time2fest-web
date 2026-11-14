'use client';

/**
 * Переклад повідомлень чату (функція пасу, рішення власника 2026-10-30). Переклад дає сервіс чату (`translate`); у `sim` —
 * готові переклади повідомлень сценарію (`cannedTranslation`), невідомий текст — з позначкою «[переклад]». У продакшні — запит до дешевої
 * моделі (Claude Haiku / OpenRouter) з кешем «повідомлення + мова» (той самий інтерфейс `translate`).
 * Мову повідомлення визначаємо за полем `lang`, якщо воно є, інакше — за прапором автора; кирилицю не перекладаємо.
 */
import { useCallback, useEffect, useState } from 'react';
import { getService } from '@/lib/api/services';
import type { ChatMessage } from '@/lib/data/types';

/** Мова сайту (поки одна). */
export const SITE_LANG = 'uk';

const BY_FLAG: Record<string, string> = {
  GB: 'en', US: 'en', AU: 'en', NZ: 'en', IE: 'en', IN: 'en', CA: 'en',
  FR: 'fr', BE: 'fr', ES: 'es', MX: 'es', AR: 'es', CO: 'es', BR: 'pt', PT: 'pt',
  DE: 'de', AT: 'de', CH: 'de', TR: 'tr', PL: 'pl', IT: 'it', JP: 'ja', KR: 'ko', EG: 'ar', AE: 'ar',
};

/** Готові переклади повідомлень сценарію (імітатор). */
const CANNED: Record<string, string> = {
  'Feliz Ano Novo, pessoal!': 'З Новим роком, друзі!',
  'Happy New Year, everyone!': 'З Новим роком усіх!',
  '明けましておめでとうございます！': 'З Новим роком!',
  'Frohes neues Jahr!': 'З Новим роком!',
  'Yeni yılınız kutlu olsun!': 'З Новим роком вас!',
  'Cześć z Polski! Czekamy na północ': 'Привіт із Польщі! Чекаємо на північ',
  'Counting down with you all 🎉': 'Рахуємо разом з усіма 🎉',
  '새해 복 많이 받으세요!': 'Щасливого Нового року!',
  'Bonne année à tous !': 'З Новим роком усіх!',
  '¡Feliz Año Nuevo desde aquí!': 'З Новим роком звідси!',
  'İstanbul’dan herkese mutlu yıllar! 🎉': 'Усім щасливого Нового року зі Стамбула! 🎉',
  'Tüm dünyaya sevgiler, yolum gizli kalsın 🙂': 'Любові всьому світу, а мій шлях хай буде таємницею 🙂',
};

const CYRILLIC = /[А-Яа-яІіЇїЄєҐґЁё]/;
const LETTERS = /\p{L}/u;

/** Мова повідомлення або `null`, якщо перекладати не треба (мова сайту, кирилиця, без тексту). */
export function messageLang(m: Pick<ChatMessage, 'text' | 'author'> & { lang?: string }): string | null {
  if (!m.text || !LETTERS.test(m.text)) return null;
  if (m.lang) return m.lang === SITE_LANG ? null : m.lang;
  if (CYRILLIC.test(m.text)) return null;
  return BY_FLAG[m.author?.flagCode.toUpperCase() ?? ''] ?? 'en';
}

const cache = new Map<string, string>();

/**
 * Переклад тексту через сервіс чату (шов E5a; у `sim` — готові переклади сценарію, решта з позначкою «[переклад]»).
 * Кеш на клієнті — на ключ «id повідомлення + мова». Сервіс не відповів — `undefined` (показуємо оригінал).
 */
export async function translate(text: string, from: string, to: string, key?: string): Promise<string | undefined> {
  const k = `${key ?? text}|${to}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  const res = await getService('chat').translate(key ?? text, text, from, to);
  if (!res.ok) return undefined;
  cache.set(k, res.value);
  return res.value;
}

/** Готовий переклад тексту без запиту (приклад у вікні «Переклад повідомлень» без пасу); немає — `undefined`. */
export function cannedTranslation(text: string): string | undefined {
  return CANNED[text];
}

/** Синхронно з кешу (щоб перекладене не блимало оригіналом після першого перекладу). */
export function cachedTranslation(id: string, to = SITE_LANG): string | undefined {
  return cache.get(`${id}|${to}`);
}

/** Повідомлення, для яких людина обрала «Оригінал» (чи навпаки «Перекласти» з меню). */
const overrides = new Map<string, 'original' | 'translated'>();
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export interface TranslateState {
  /** Мова оригіналу (`null` — перекладати нічого). */
  lang: string | null;
  /** Показати переклад зараз. */
  showing: boolean;
  /** Готовий переклад (може ще вантажитися). */
  text: string | undefined;
  /** Сервіс не переклав (стан шва №13): показуємо оригінал і «Не вдалося перекласти · Спробувати ще». */
  failed: boolean;
  /** Спробувати перекласти ще раз. */
  retry(): void;
  /** Перемкнути «переклад ↔ оригінал» для цього повідомлення. */
  toggle(): void;
  /** Показати переклад (для меню повідомлення «Перекласти»). */
  translateNow(): void;
}

/**
 * Стан перекладу одного повідомлення. `auto` — увімкнено «Перекладати повідомлення».
 * Меню повідомлення викликає `translateNow` (дія «Перекласти») — це і є обробник для меню.
 */
export function useTranslateMessage(message: Pick<ChatMessage, 'id' | 'text' | 'author'> & { lang?: string }, auto: boolean): TranslateState {
  const lang = messageLang(message);
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const ov = overrides.get(message.id);
  const showing = !!lang && (ov ? ov === 'translated' : auto);
  const [text, setText] = useState<string | undefined>(() => cachedTranslation(message.id));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!showing || !lang || text !== undefined || !message.text || failed) return;
    let live = true;
    void translate(message.text, lang, SITE_LANG, message.id).then((out) => {
      if (!live) return;
      if (out === undefined) setFailed(true);
      else setText(out);
    });
    return () => {
      live = false;
    };
  }, [showing, lang, text, message.text, message.id, failed, attempt]);
  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);
  const toggle = useCallback(() => {
    overrides.set(message.id, showing ? 'original' : 'translated');
    emit();
  }, [message.id, showing]);
  const translateNow = useCallback(() => {
    overrides.set(message.id, 'translated');
    emit();
  }, [message.id]);
  return { lang, showing, text, failed: showing && failed && text === undefined, retry, toggle, translateNow };
}

/** Для тестів: забути переклади й вибір «Оригінал». */
export function resetTranslations(): void {
  cache.clear();
  overrides.clear();
  emit();
}
