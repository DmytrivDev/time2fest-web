'use client';

import { useEffect } from 'react';

/**
 * Демо й тестова збірка: кореневий макет сайту ставить `<html lang="uk">` для всіх сторінок, тож мовне дерево
 * виправляє мову документа в браузері. У збірці для домену `<html lang>` одразу правильний (макет мовного дерева —
 * кореневий), і цей компонент не використовується.
 */
export function LocaleLang({ locale }: { locale: string }) {
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = locale;
    return () => {
      root.lang = before;
    };
  }, [locale]);
  return null;
}
