'use client';

/**
 * Заглушка стокового фото (дизайн v3): нічне небо, силует міста й кілька феєрверків на canvas. Детермінована від
 * `seed`, тож кадр той самий після кожного завантаження. Коли з’являться стокові кадри — замінити на `<img>`.
 * Кольори феєрверків — токени сайту (жовтий, кораловий) та їхні світлі відтінки з дизайну.
 */
import { useEffect, useRef } from 'react';

export const SCENE_COLORS = ['#FCE286', '#F94A51', '#FFF1BF', '#EDB843', '#FF9B8A', '#BFD7FF'];

export function seeded(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export interface SceneOptions {
  bursts?: number;
  /** Тепліше небо внизу (ролик). */
  warm?: boolean;
}

/** Намалювати сцену в контекст розміром `w × h` (CSS px). */
export function drawScene(g: CanvasRenderingContext2D, w: number, h: number, seed: number, opts: SceneOptions = {}): void {
  const r = seeded(seed + 1);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#0B0B14');
  sky.addColorStop(1, opts.warm ? '#2A1A1E' : '#1A1622');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const bursts = opts.bursts ?? 3;
  for (let b = 0; b < bursts; b++) {
    const cx = w * (0.15 + 0.7 * r());
    const cy = h * (0.15 + 0.35 * r());
    const rad = Math.min(w, h) * (0.12 + 0.16 * r());
    const col = SCENE_COLORS[Math.floor(r() * SCENE_COLORS.length)]!;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.6);
    glow.addColorStop(0, `${col}55`);
    glow.addColorStop(1, `${col}00`);
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = col;
    g.lineCap = 'round';
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * Math.PI * 2 + r() * 0.1;
      const l = rad * (0.55 + 0.45 * r());
      g.globalAlpha = 0.55 + 0.45 * r();
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * l * 0.25, cy + Math.sin(a) * l * 0.25);
      g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
      g.stroke();
      g.fillStyle = col;
      g.beginPath();
      g.arc(cx + Math.cos(a) * l, cy + Math.sin(a) * l, 1.4, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  g.fillStyle = '#08080C';
  g.beginPath();
  g.moveTo(0, h);
  let x = 0;
  while (x < w) {
    const bw = w * (0.03 + 0.06 * r());
    let bh = h * (0.12 + 0.3 * r());
    if (r() < 0.12) bh = h * (0.45 + 0.15 * r());
    g.lineTo(x, h - bh);
    g.lineTo(x + bw, h - bh);
    x += bw;
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(252,226,134,.5)';
  for (let q = 0; q < 60; q++) g.fillRect(r() * w, h - r() * h * 0.3, 1.2, 1.2);
}

/** Canvas на всю площу батька (батько — `position: relative`), перемальовується при зміні розміру. */
export function SceneCanvas({ seed, bursts, warm, className }: { seed: number; className?: string } & SceneOptions) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const paint = () => {
      const w = cv.clientWidth || 320;
      const h = cv.clientHeight || 180;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      const g = cv.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawScene(g, w, h, seed, { ...(bursts ? { bursts } : {}), ...(warm ? { warm } : {}) });
    };
    paint();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(paint) : null;
    ro?.observe(cv);
    return () => ro?.disconnect();
  }, [seed, bursts, warm]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    />
  );
}
