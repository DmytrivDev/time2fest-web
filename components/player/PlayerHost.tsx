'use client';

/**
 * PlayerHost — ОДИН контейнер плеєра на весь `(live)`-макет (ІНВ 4.1, research.md 3).
 * - `position: fixed` над `PlayerSlot` за `getBoundingClientRect()`; оновлення на
 *   `ResizeObserver` / `IntersectionObserver` / `scroll` / `resize`;
 * - ніколи не переноситься в DOM і не має React-дітей: iframe створює IFrame API у вузлі,
 *   доданому в effect (`PlayerProvider.attachHost`);
 * - слот поза екраном → `visibility: hidden`; менше 200×200 → схований;
 * - позиція пишеться прямо в `style` (без ререндерів на кожну прокрутку).
 * Нічого не лежить поверх хоста: z-index вище за вміст сторінки, нижче лише за мініплеєр (той самий хост).
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { usePlayer, usePlayerInternals } from '@/lib/player/PlayerProvider';
import { computeHostPlacement } from '@/lib/player/placement';

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
    let frame = 0;

    const apply = () => {
      frame = 0;
      const rect = slotElement ? slotElement.getBoundingClientRect() : null;
      const p = computeHostPlacement(rect, { width: window.innerWidth, height: window.innerHeight }, hasVideo);
      const s = host.style;
      s.top = `${p.top}px`;
      s.left = `${p.left}px`;
      s.width = `${p.width}px`;
      s.height = `${p.height}px`;
      s.visibility = p.visible ? 'visible' : 'hidden';
      // Кути як у слоту (телефон — без кутів, десктоп — rounded.lg).
      if (slotElement) s.borderRadius = getComputedStyle(slotElement).borderRadius;
      host.dataset.visible = p.visible ? 'true' : 'false';
      // Схований хост не повинен бути в порядку Tab і для зчитувача.
      host.inert = !p.visible;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    if (!slotElement) return () => cancelAnimationFrame(frame);

    const ro = new ResizeObserver(schedule);
    ro.observe(slotElement);
    ro.observe(document.documentElement);
    const io = new IntersectionObserver(schedule, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    io.observe(slotElement);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [slotElement, hasVideo]);

  // Без дітей і без керованого React `style`: позицію ставить effect вище.
  return <div ref={hostRef} data-player-host="" className="invisible fixed z-30 overflow-hidden" />;
}
