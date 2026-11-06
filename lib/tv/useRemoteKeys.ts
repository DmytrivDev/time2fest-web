'use client';

/**
 * Керування ТВ з пульта чи клавіатури (EXPERIENCE S-TV): ← → ↑ ↓ — переміщення фокуса до найближчого
 * елемента в цьому напрямку, OK/Enter — стандартна дія сфокусованого елемента, Esc / «Назад» — вихід.
 *
 * - початковий фокус — перша картка черги (`[data-tv-initial]`);
 * - фокус ніколи не потрапляє на плеєр (`[data-player-host]`): відео керується кнопками смуги керування;
 * - вкладки (`role="tab"`) самі обробляють ← →, тому тут горизонтальні стрілки на них не чіпаємо;
 * - область із `data-tv-scroll` у фокусі гортається ↑ ↓, поки є куди; тоді фокус іде далі;
 * - «Назад» спершу закриває відкритий таймлайн (`onBack` повертає `true`, якщо подію оброблено), інакше — вихід.
 */
import { useEffect, useRef, type RefObject } from 'react';

export type TvDirection = 'left' | 'right' | 'up' | 'down';

const ARROWS: Record<string, TvDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Клавіші «Назад» на пультах і в браузерах ТВ. */
const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'XF86Back', 'Backspace']);

const FOCUSABLE = 'a[href], button:not([disabled]), [role="tab"], [tabindex="0"]';

function isUsable(el: HTMLElement): boolean {
  if (el.closest('[data-player-host], [inert], [hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

interface Box {
  el: HTMLElement;
  cx: number;
  cy: number;
  rect: DOMRect;
}

/** Найкращий кандидат у напрямку: близький по осі руху, мало зсунутий убік. */
export function pickNext(from: DOMRect, candidates: readonly Box[], dir: TvDirection): HTMLElement | null {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: { el: HTMLElement; score: number } | null = null;
  for (const c of candidates) {
    const dx = c.cx - fx;
    const dy = c.cy - fy;
    const along = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    if (along <= 1) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    // Перекриття по поперечній осі зменшує штраф: елемент «прямо по курсу» перемагає ближчий, але збоку.
    const overlap =
      dir === 'left' || dir === 'right'
        ? Math.min(from.bottom, c.rect.bottom) - Math.max(from.top, c.rect.top)
        : Math.min(from.right, c.rect.right) - Math.max(from.left, c.rect.left);
    const score = along + (overlap > 0 ? across * 0.5 : across * 3 + 200);
    if (!best || score < best.score) best = { el: c.el, score };
  }
  return best?.el ?? null;
}

function candidatesIn(root: ParentNode, skip: HTMLElement | null): Box[] {
  const out: Box[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el === skip || !isUsable(el)) continue;
    // У групі вкладок фокус ходить по вибраній вкладці; решта (tabindex=-1) — досяжна стрілками ↑ ↓ за геометрією.
    const rect = el.getBoundingClientRect();
    out.push({ el, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, rect });
  }
  return out;
}

function scrollStep(el: HTMLElement, dir: TvDirection): boolean {
  if (dir !== 'up' && dir !== 'down') return false;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return false;
  const next = el.scrollTop + (dir === 'down' ? 1 : -1) * Math.round(el.clientHeight / 3);
  if ((dir === 'down' && el.scrollTop >= max - 1) || (dir === 'up' && el.scrollTop <= 0)) return false;
  el.scrollTo({ top: Math.max(0, Math.min(max, next)) });
  return true;
}

const reducedMotion = () => document.documentElement.dataset.reduceMotion === 'true';

/** Поле від краю смуги до картки у фокусі: контур фокуса (4 + 2 px) і тінь не обрізаються. */
const STRIP_PAD = 14;

/**
 * Горизонтальна смуга (`data-tv-strip`): гортаємо рівно на стільки, щоб картка стала видимою з полем, — по одній картці
 * на натискання. Смуга в макеті, що масштабується, тож відстані екрана ділимо на масштаб. `scrollIntoView` тут не годиться:
 * часті натискання з плавною прокруткою перебивають одне одного, і картка лишалась за краєм.
 */
export function revealInStrip(el: HTMLElement, strip: HTMLElement, smooth: boolean): void {
  const s = strip.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const scale = s.width / strip.offsetWidth || 1;
  const left = (r.left - s.left) / scale;
  const right = (r.right - s.left) / scale;
  let delta = 0;
  if (left < STRIP_PAD) delta = left - STRIP_PAD;
  else if (right > strip.clientWidth - STRIP_PAD) delta = right - (strip.clientWidth - STRIP_PAD);
  if (delta) strip.scrollTo({ left: strip.scrollLeft + delta, behavior: smooth ? 'smooth' : 'auto' });
}

export interface RemoteKeysOptions {
  /** Корінь, у якому шукаємо фокусні елементи. */
  rootRef: RefObject<HTMLElement | null>;
  /** Вихід із режиму вечірки (головна). */
  onExit: () => void;
  /** «Назад» усередині екрана (закрити таймлайн). `true` — оброблено, виходити не треба. */
  onBack?: () => boolean;
  /** Ефір готовий (час відомий): можна ставити початковий фокус. */
  ready?: boolean;
}

export function useRemoteKeys({ rootRef, onExit, onBack, ready = true }: RemoteKeysOptions): void {
  // Початковий фокус: перша картка черги (або перший фокусний елемент, якщо черги немає). Картки з’являються,
  // щойно відомий час, тож чекаємо `ready` і ще трохи, поки картка потрапить у DOM; лише один раз.
  // Таймер, а не `requestAnimationFrame`: у фоновій вкладці кадри не йдуть.
  const focused = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !ready || focused.current) return;
    let ticks = 0;
    const tick = () => {
      const done = () => {
        focused.current = true;
        window.clearInterval(id);
      };
      if (document.activeElement && document.activeElement !== document.body) return done();
      const card = root.querySelector<HTMLElement>('[data-tv-initial]');
      if (card) {
        card.focus();
        return done();
      }
      if (++ticks > 60) {
        candidatesIn(root, null).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.el.focus();
        done();
      }
    };
    const id = window.setInterval(tick, 50);
    tick();
    return () => window.clearInterval(id);
  }, [rootRef, ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const root = rootRef.current;
      if (!root) return;

      if (BACK_KEYS.has(e.key)) {
        const target = e.target as HTMLElement | null;
        // Backspace у полі введення (на ТВ їх немає) не повинен виходити.
        if (e.key === 'Backspace' && target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
        e.preventDefault();
        if (!onBack?.()) onExit();
        return;
      }

      const dir = ARROWS[e.key];
      if (!dir) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute('role') === 'tab' && (dir === 'left' || dir === 'right')) return;

      if (active?.hasAttribute('data-tv-scroll') && scrollStep(active, dir)) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      if (!active || active === document.body || !root.contains(active)) {
        const first = root.querySelector<HTMLElement>('[data-tv-initial]') ?? candidatesIn(root, null)[0]?.el;
        first?.focus();
        return;
      }
      const next = pickNext(active.getBoundingClientRect(), candidatesIn(root, active), dir);
      if (next) {
        // Без прокрутки браузера (`focus()` ставить елемент по центру — смуга стрибала на 3 картки): гортаємо самі
        // рівно настільки, щоб картка стала видимою, — по одній на натискання (поле — `scroll-padding` смуги).
        next.focus({ preventScroll: true });
        const strip = next.closest<HTMLElement>('[data-tv-strip]');
        if (strip) revealInStrip(next, strip, !reducedMotion());
        else next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rootRef, onExit, onBack]);
}
