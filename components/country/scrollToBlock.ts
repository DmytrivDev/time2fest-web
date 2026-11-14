/**
 * «Дивитися, що вже йде ↓» на заглушці головного святкування (рішення власника 2026-11-13): плавно до блоку
 * («Зараз і далі» чи «Трансляції · Країна») і фокус на ньому. «Зменшити рух» — стрибок без анімації.
 * Закріплений плеєр (планшет-альбом) не накриває блок: `scroll-padding-top` макета.
 */
export function scrollToBlock(id: string, reduced: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}
