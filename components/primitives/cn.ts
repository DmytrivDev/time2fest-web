import './primitives.css';

/** Склеює класи; значення false/null/undefined пропускає. Конфліктів не вирішує: компонувати варіанти так, щоб їх не було. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
