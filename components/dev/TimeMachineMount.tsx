'use client';

/**
 * Монтує `TimeMachinePanel` лише в тестовій збірці. `NEXT_PUBLIC_ENV` підставляється під час збирання,
 * тож у робочому пакеті гілка з `dynamic(import(...))` відсікається разом із панеллю.
 */
import dynamic from 'next/dynamic';

// Прямий `process.env.NEXT_PUBLIC_ENV` (як у `lib/env.ts`): сам збирач підставляє значення й відсікає гілку
// разом із чанком панелі; константа, імпортована з іншого модуля, цього не гарантує.
function loadPanel() {
  if (process.env.NEXT_PUBLIC_ENV !== 'test') return null;
  return dynamic(() => import('./TimeMachinePanel').then((m) => m.TimeMachinePanel), { ssr: false });
}

const Panel = loadPanel();

export function TimeMachineMount() {
  return Panel ? <Panel /> : null;
}
