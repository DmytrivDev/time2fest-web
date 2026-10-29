'use client';

/**
 * Лише тестова збірка: перемкнули режим пристрою в інструментах розробника (миша ↔ дотик) — сторінка перезавантажується.
 * Частина рішень сайту залежить від типу пристрою (`pointer: coarse`, мобільний браузер, торкання), і браузер не завжди
 * чисто перемальовує вже відкриту сторінку; перезавантаження дає той самий вигляд, що й відкриття сторінки на телефоні.
 * У робочій збірці не діє: гібридний ноутбук (від’єднали клавіатуру) не має перезавантажуватися посеред трансляції.
 */
import { useEffect } from 'react';

const QUERIES = ['(pointer: coarse)', '(hover: none)'];

export function DeviceModeReload() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENV !== 'test' || typeof window.matchMedia !== 'function') return;
    const lists = QUERIES.map((q) => window.matchMedia(q));
    const reload = () => window.location.reload();
    lists.forEach((l) => l.addEventListener('change', reload));
    return () => lists.forEach((l) => l.removeEventListener('change', reload));
  }, []);
  return null;
}
