'use client';

/**
 * Верх шторки на телефоні й планшеті-портреті — одне правило для всіх шторок сайту (рішення власника 2026-11-10,
 * уточнює стандарт 2026-11-04). Два види:
 * - `chat` — чат і все, що відкривається з чату (картка автора, нік, переклад): верх — під відео, рядком часу й усім,
 *   що позначено `[data-dock-above]` (рядок часу, рядок країни; смуга під плеєром, якщо позначить себе так само).
 *   «Перший ряд», чия смуга тут була, прибрано 2026-11-12 — тепер чат стає одразу під рядком часу;
 * - `video` — усе решта (меню, сповіщення, «Ще дії», пас, тост, вхід, «Поділитися» тощо): верх — під
 *   відео (низ плеєра).
 * Кімната перегляду: обидва види — під усією сіткою вікон (`[data-video-column]`). Сторінка без відео (пас, вхід,
 * кабінет, «Країни й міста», графік…): обидва види — там, де під шапкою був би низ відео 16:9 (шапка + ширина × 9/16),
 * як на головній. Положення — як на початку сторінки (scrollTop = 0); не нижче, ніж за 240 px до низу екрана.
 * Користуються: `ChatDock` (чат і шар вікон), `Sheet`, бічне вікно меню й сповіщень поза `(live)` (`SideDialog`).
 */
import { useLayoutEffect, useState } from 'react';

export type SheetTopKind = 'chat' | 'video';

/** Найменша висота шторки: якщо під відео менше місця, верх піднімається. */
const MIN_SHEET = 240;
/** Нижня рамка рядка часу / відео лишається видно над шторкою (правка власника 2026-11-02). */
const GAP = 2;

/**
 * Стабільна висота екрана — `100svh` (найменша: з видимою адресною стрічкою). Висота вікна на телефоні змінюється,
 * коли під час прокрутки ховається адресна стрічка; від неї шторки стрибали б (рішення 2026-10-28).
 */
export function stableViewportH(): number {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:100svh;width:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height || window.innerHeight;
  probe.remove();
  return h;
}

/** Низ відео в координатах сторінки: плеєр, сітка кімнати, а без них — шапка + 16:9 від ширини. */
function videoBottom(): number {
  const column = document.querySelector<HTMLElement>('[data-video-column]');
  if (column) return column.getBoundingClientRect().bottom + window.scrollY;
  const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
  if (slot) return slot.getBoundingClientRect().bottom + window.scrollY;
  // Шапка завжди вгорі сторінки; її висота (а не положення) — бо при прокрутці шапка може ховатися чи липнути.
  const header = document.querySelector<HTMLElement>('header');
  const headerH = header ? header.getBoundingClientRect().height : 0;
  return headerH + Math.round((document.documentElement.clientWidth * 9) / 16);
}

/** Верх шторки (px від верху вікна) за видом шторки. */
export function measureSheetTop(kind: SheetTopKind): number {
  if (typeof document === 'undefined') return 0;
  let bottom = videoBottom();
  if (kind === 'chat' && !document.querySelector('[data-video-column]')) {
    document.querySelectorAll<HTMLElement>('[data-dock-above]').forEach((el) => {
      bottom = Math.max(bottom, el.getBoundingClientRect().bottom + window.scrollY);
    });
  }
  return Math.max(0, Math.min(Math.round(bottom) + GAP, Math.max(0, stableViewportH() - MIN_SHEET)));
}

/** Те, від чого залежить верх шторки: перемірюємо, коли змінюється їхній розмір. */
export const SHEET_TOP_SOURCES = '[data-dock-above], [data-player-slot="main"], [data-video-column], header';

/**
 * Верх шторки, поки `active`: міряємо при відкритті, зміні ширини вікна (поворот) і зміні розміру відео, рядка часу,
 * смуги чи шапки. Зміну лише висоти (адресна стрічка) пропускаємо. Перший замір — до першого кадру; до нього `undefined`.
 */
export function useSheetTop(kind: SheetTopKind, active: boolean): number | undefined {
  const [top, setTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!active) return;
    const measure = () => setTop(measureSheetTop(kind));
    measure();
    const frame = requestAnimationFrame(measure);
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      measure();
    };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    document.querySelectorAll(SHEET_TOP_SOURCES).forEach((el) => ro?.observe(el));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [kind, active]);
  return top;
}
