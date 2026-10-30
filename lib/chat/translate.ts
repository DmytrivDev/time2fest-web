'use client';

/**
 * Переклад повідомлень чату (функція пасу, рішення власника 2026-10-30). Поки без бекенду: імітатор з готовими
 * перекладами повідомлень сценарію; невідомий текст — з позначкою «[переклад]». У продакшні — запит до дешевої
 * моделі (Claude Haiku / OpenRouter) з кешем «повідомлення + мова» (той самий інтерфейс `translate`).
 * Мову повідомлення визначаємо за полем `lang`, якщо воно є, інакше — за прапором автора; кирилицю не перекладаємо.
 */
import { useCallback, useEffect, useState } from 'react';
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

/** Переклад тексту (імітатор). Кеш — на ключ «id повідомлення + мова». */
export async function translate(text: string, from: string, to: string, key?: string): Promise<string> {
  const k = `${key ?? text}|${to}`;
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  void from;
  const out = CANNED[text] ?? `[переклад] ${text}`;
  cache.set(k, out);
  return out;
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
  useEffect(() => {
    if (!showing || !lang || text !== undefined || !message.text) return;
    let live = true;
    void translate(message.text, lang, SITE_LANG, message.id).then((out) => {
      if (live) setText(out);
    });
    return () => {
      live = false;
    };
  }, [showing, lang, text, message.text, message.id]);
  const toggle = useCallback(() => {
    overrides.set(message.id, showing ? 'original' : 'translated');
    emit();
  }, [message.id, showing]);
  const translateNow = useCallback(() => {
    overrides.set(message.id, 'translated');
    emit();
  }, [message.id]);
  return { lang, showing, text, toggle, translateNow };
}

/** Для тестів: забути переклади й вибір «Оригінал». */
export function resetTranslations(): void {
  cache.clear();
  overrides.clear();
  emit();
}
