'use client';

/**
 * PlayerHost — ОДИН контейнер плеєра на весь `(live)`-макет (ІНВ 4.1, research.md 3).
 * - Стоїть **абсолютно** в `.shell` макета (position: relative) над `PlayerSlot`: обидва в одній системі координат
 *   документа, тож прокрутка не потребує JS і відео не «стрибає». Позиція перераховується лише на зміну розмірів
 *   (`ResizeObserver` слоту, оболонки, документа) і на зміну режиму;
 * - `fixed` — лише коли слот сам нерухомий відносно вікна: телефонний закріплений стан (sticky-слот дійшов до верху)
 *   або слот у `position: fixed`;
 * - ніколи не переноситься в DOM і не має React-дітей: iframe створює IFrame API у вузлі,
 *   доданому в effect (`PlayerProvider.attachHost`);
 * - менше 200×200 або немає відео → схований (`visibility: hidden`, `inert`).
 * Нічого не лежить поверх хоста: z-index вище за вміст сторінки, нижче за вікна й банери, які ніколи не стають
 * на прямокутник плеєра (див. CookieLayer).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePlayer, usePlayerInternals } from '@/lib/player/PlayerProvider';
import { computeHostPlacement, type HostMode } from '@/lib/player/placement';

/** Найближчий предок у `position: fixed`. */
function inFixedContext(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).position === 'fixed') return true;
  }
  return false;
}

export function PlayerHost() {
  const hostRef = useRef<HTMLDivElement>(null);
  const { attachHost, slotElement } = usePlayerInternals();
  const { videoId } = usePlayer();
  const hasVideo = videoId !== null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return attachHost(host);
  }, [attachHost]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const parentOf = () => (host.offsetParent instanceof HTMLElement ? host.offsetParent : (host.parentElement ?? document.body));
    const parent = parentOf();
    // Телефон: sticky-слот дійшов до верху вікна (закріплений стан).
    let pinned = false;

    // Синхронно (ResizeObserver і так спрацьовує до малювання): rAF у фоновій вкладці не викликається, і хост лишався
    // зі старими розмірами, коли сторінку показали згодом (зсув відео відносно слоту).
    const apply = () => {
      const rect = slotElement ? slotElement.getBoundingClientRect() : null;
      let mode: HostMode = 'absolute';
      if (slotElement && inFixedContext(slotElement)) mode = 'fixed';
      else if (slotElement && rect && (pinned || rect.top <= 0.5) && getComputedStyle(slotElement).position === 'sticky' && rect.top <= 0.5) mode = 'fixed';
      const origin = mode === 'absolute' ? parentOf().getBoundingClientRect() : { top: 0, left: 0 };
      const p = computeHostPlacement(rect, origin, mode, hasVideo);
      const s = host.style;
      s.position = p.mode;
      s.top = `${p.top}px`;
      s.left = `${p.left}px`;
      s.width = `${p.width}px`;
      s.height = `${p.height}px`;
      s.visibility = p.visible ? 'visible' : 'hidden';
      // Кути як у слоту (телефон — без кутів, десктоп — rounded.lg).
      if (slotElement) s.borderRadius = getComputedStyle(slotElement).borderRadius;
      host.dataset.visible = p.visible ? 'true' : 'false';
      host.dataset.mode = p.mode;
      // Схований хост не повинен бути в порядку Tab і для зчитувача.
      host.inert = !p.visible;
    };
    const schedule = () => apply();

    apply();
    if (!slotElement) return;

    const ro = new ResizeObserver(schedule);
    ro.observe(slotElement);
    ro.observe(parent);
    ro.observe(document.documentElement);
    // Верхній край слоту ховається за край вікна (rootMargin −1 px) → слот прилип угорі (телефон, sticky).
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[entries.length - 1];
        if (!e) return;
        const next = e.intersectionRatio < 1 && e.boundingClientRect.top <= 0.5;
        if (next !== pinned) {
          pinned = next;
          apply();
        }
      },
      { rootMargin: '-1px 0px 0px 0px', threshold: [1] },
    );
    io.observe(slotElement);
    // Точки перелому, повернення у видиму вкладку (розміри могли змінитися, поки вона була схована).
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    // Страховка від застарілих розмірів (ResizeObserver не спрацьовує, поки сторінка не малюється — схована панель):
    // координати хоста не залежать від прокрутки, тож перерахунок на прокрутку нічого не зсуває, лише виправляє.
    window.addEventListener('scroll', schedule, { passive: true });

    return () => {
      window.removeEventListener('scroll', schedule);
      document.removeEventListener('visibilitychange', schedule);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [slotElement, hasVideo]);

  // Без дітей і без керованого React `style`: позицію ставить effect вище.
  return <div ref={hostRef} data-player-host="" className="invisible absolute z-30 overflow-hidden" />;
}
