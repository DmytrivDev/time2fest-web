'use client';

/**
 * Плавна заміна вікна під мапою «пояс ↔ країна» (рішення власника 2026-11-04, варіант B): вікно країни заїжджає справа,
 * «‹ До поясу» повертає пояс зліва; висота вікна пливе від старої до нової. Інші заміни (сусідній пояс, інший пояс
 * країни) — як і були, миттєво. «Зменшити рух» — без анімації.
 *
 * Як це влаштовано: клік усередині вікна знімає копію його DOM (лише для показу — `inert`, `aria-hidden`, без id і
 * службових `data-*`); коли після кліку змінився `swapKey`, копія виїжджає, нове вікно заїжджає (Web Animations API).
 *
 * Відкотити: `PANEL_SWAP = 'off'` — вікна знову міняються миттєво (компонент лишається простою обгорткою).
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export const PANEL_SWAP: 'slide' | 'off' = 'slide';

const MS = 320;
const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
/** Зсув як частка ширини вікна. */
const SHIFT = 0.15;
/** Найдовше чекаємо «вільної» сторінки перед рухом (мс). */
const SETTLE_MAX = 600;
/** Скільки після кліку чекаємо зміни вікна (мс). */
const CAPTURE_TTL = 600;
/** Службові атрибути, від яких залежить вигляд (решту `data-*` з копії прибираємо — тести й скрипти її не бачать). */
const KEEP = new Set(['data-open', 'data-state', 'data-layout', 'data-badge', 'data-zero']);

function motionOn(): boolean {
  if (PANEL_SWAP === 'off' || typeof window === 'undefined') return false;
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function')
    return false;
  if (document.documentElement.getAttribute('data-reduce-motion') === 'true') return false;
  return !(
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function strip(node: Element) {
  for (const el of [node, ...node.querySelectorAll('*')]) {
    el.removeAttribute('id');
    for (const a of [...el.attributes])
      if (a.name.startsWith('data-') && !KEEP.has(a.name)) el.removeAttribute(a.name);
  }
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('inert', '');
}

/** `z:…` — вікно поясу, `c:…` — вікно країни. */
const kind = (key: string) => key.slice(0, 1);

export function PanelSwap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const prevKey = useRef(swapKey);
  const shot = useRef<{ node: HTMLElement; h: number; at: number } | null>(null);

  useLayoutEffect(() => {
    const from = prevKey.current;
    prevKey.current = swapKey;
    const cap = shot.current;
    shot.current = null;
    const el = box.current;
    if (from === swapKey || !cap || !el || performance.now() - cap.at > CAPTURE_TTL) return;
    const dir =
      kind(from) === 'z' && kind(swapKey) === 'c'
        ? 1
        : kind(from) === 'c' && kind(swapKey) === 'z'
          ? -1
          : 0;
    const fresh = el.firstElementChild as HTMLElement | null;
    if (!dir || !fresh || !motionOn()) return;
    const w = el.clientWidth;
    const shift = `translateX(${dir * SHIFT * w}px)`;
    const away = `translateX(${-dir * SHIFT * w}px)`;
    const old = cap.node;
    old.style.cssText += `;position:absolute;top:0;left:0;width:${w}px;margin:0;pointer-events:none`;
    el.appendChild(old);
    // Стан «до» — одразу (ще до першого кадру): стара висота, старе вікно на місці, нове — збоку й прозоре. Рух
    // запускаємо з першого вільного кадру: побудова нового вікна може зайняти час, і без цього анімація «минала б» без
    // жодного кадру.
    el.style.overflow = 'hidden';
    el.style.height = `${cap.h}px`;
    fresh.style.transform = shift;
    fresh.style.opacity = '0';
    let cancelled = false;
    const clear = () => {
      old.remove();
      for (const k of ['overflow', 'height']) el.style.removeProperty(k);
      for (const k of ['transform', 'opacity']) fresh.style.removeProperty(k);
    };
    const start = () => {
      if (cancelled) return;
      el.style.height = 'auto';
      const h = el.offsetHeight;
      el.style.height = `${cap.h}px`;
      const opts = { duration: MS, easing: EASE };
      const height = el.animate([{ height: `${cap.h}px` }, { height: `${h}px` }], opts);
      fresh.animate(
        [
          { transform: shift, opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        opts,
      );
      old.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: away, opacity: 0 },
        ],
        opts,
      );
      height.onfinish = clear;
      height.oncancel = clear;
    };
    // Чекаємо, доки сторінка «звільниться»: два кадри поспіль швидкі (побудова нового вікна й ефекти позаду), але не
    // довше за SETTLE_MAX — інакше рух ішов би під час зависання й людина побачила б лише кінець.
    const t0 = performance.now();
    let last = t0;
    let calm = 0;
    let raf = 0;
    const wait = (t: number) => {
      calm = t - last < 40 ? calm + 1 : 0;
      last = t;
      if (calm >= 2 || t - t0 > SETTLE_MAX) start();
      else raf = requestAnimationFrame(wait);
    };
    raf = requestAnimationFrame(wait);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clear();
    };
  }, [swapKey]);

  return (
    <div
      ref={box}
      style={{ position: 'relative' }}
      onClickCapture={() => {
        const el = box.current;
        const cur = el?.firstElementChild;
        if (!el || !cur || !motionOn()) return;
        const node = cur.cloneNode(true) as HTMLElement;
        strip(node);
        shot.current = { node, h: el.offsetHeight, at: performance.now() };
      }}
    >
      {children}
    </div>
  );
}
