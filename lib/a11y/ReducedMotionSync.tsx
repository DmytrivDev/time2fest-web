'use client';

import { useReducedMotionAttribute } from './reducedMotion';

/** Один раз у дереві (наприклад у `<body>`): оновлює атрибут при зміні системи чи перемикача сайту. */
export function ReducedMotionSync() {
  useReducedMotionAttribute();
  return null;
}
