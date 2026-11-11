'use client';

/**
 * Салют і конфеті опівночі на сцені відліку (власник 2026-11-11). Canvas поверх листівки, під текстом; клацань не ловить.
 * Ракети злітають знизу й розсипаються іскрами (кулі, «верби», двоколірні); на старті — злива конфеті. Кожен вибух —
 * зі звуком, якщо звук сцени ввімкнено: записаний салют (`startFireworksSound`), а поки запису немає — синтез вибуху. Без спалахів на весь кадр (попередження про спалахи на сайті).
 */
import { useEffect, useRef } from 'react';
import { hasRecordedFireworks, playBurst, startFireworksSound, stopFireworksSound } from '@/lib/scene/sceneAudio';

/** Скільки триває салют після півночі, мс. */
export const FIREWORKS_MS = 40_000;

const PALETTE = ['#ffd166', '#ff6b6b', '#ff8fd8', '#6ee7ff', '#fff3d6', '#9cff8a', '#b28dff', '#ffb347'];

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  /** Сила тяжіння, частка від базової («верба» падає сильніше й довше світить). */
  heavy: number;
}
interface Rocket {
  x: number;
  y: number;
  vy: number;
  targetY: number;
  color: string;
}
interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  sway: number;
}

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]!;

export function Fireworks({ elapsedMs = 0, className }: { /** Скільки вже минуло від півночі (сцена відкрилась пізніше). */ elapsedMs?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const startOffset = useRef(elapsedMs);

  useEffect(() => {
    const canvas = ref.current;
    const c = canvas?.getContext('2d');
    if (!canvas || !c) return;
    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const sparks: Spark[] = [];
    const rockets: Rocket[] = [];
    const confetti: Confetti[] = [];
    const S = () => Math.min(W, H * 1.6);
    const gravity = () => S() * 0.32;

    const launch = () => {
      const x = W * (0.12 + Math.random() * 0.76);
      const targetY = H * (0.12 + Math.random() * 0.33);
      const g = gravity() * 1.15;
      const vy = -Math.sqrt(2 * g * (H - targetY));
      rockets.push({ x, y: H + 4, vy, targetY, color: pick(PALETTE) });
    };

    const explode = (r: Rocket) => {
      const kind = Math.random();
      const willow = kind < 0.2;
      const twoTone = kind > 0.7;
      const n = Math.round((willow ? 70 : 90) + Math.random() * 60);
      const speed = S() * (0.28 + Math.random() * 0.22);
      const second = pick(PALETTE);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.08;
        const v = speed * (0.55 + Math.random() * 0.45);
        sparks.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life: 0,
          max: willow ? 2.4 + Math.random() * 0.8 : 1.1 + Math.random() * 0.8,
          color: willow ? '#ffcf70' : twoTone && i % 2 ? second : r.color,
          size: willow ? 1.6 : 2 + Math.random() * 1.2,
          heavy: willow ? 1.6 : 1,
        });
      }
      if (!recorded) playBurst(willow ? 0.8 : 0.9 + Math.random() * 0.35, r.x / W);
    };

    const rain = (count: number) => {
      for (let i = 0; i < count; i++) {
        const w = 6 + Math.random() * 6;
        confetti.push({
          x: Math.random() * W,
          y: -20 - Math.random() * H * 0.6,
          vx: (Math.random() - 0.5) * S() * 0.08,
          vy: S() * (0.12 + Math.random() * 0.16),
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 9,
          w,
          h: w * (0.4 + Math.random() * 0.3),
          color: pick(PALETTE),
          sway: Math.random() * Math.PI * 2,
        });
      }
    };

    // Розклад: перша секунда — залп із п'яти ракет і конфеті; далі ракета кожні 0,35–0,9 с; останні 8 с — рідше.
    let elapsed = startOffset.current / 1000;
    const recorded = startFireworksSound(elapsed) || hasRecordedFireworks();
    let nextLaunch = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (elapsed < 1) {
      for (let i = 0; i < 5; i++) timers.push(setTimeout(launch, i * 220));
      rain(Math.round(Math.min(160, W / 4)));
      nextLaunch = 1.2;
    }
    let last = performance.now();
    let raf = 0;
    const frame = (ts: number) => {
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      elapsed += dt;
      const total = FIREWORKS_MS / 1000;
      if (elapsed < total - 2 && elapsed >= nextLaunch) {
        launch();
        const late = elapsed > total - 10;
        nextLaunch = elapsed + (late ? 0.9 + Math.random() * 0.9 : 0.35 + Math.random() * 0.55);
      }

      c.clearRect(0, 0, W, H);
      const g = gravity();

      c.globalCompositeOperation = 'lighter';
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]!;
        r.vy += g * 1.15 * dt;
        r.y += r.vy * dt;
        c.fillStyle = '#fff3d6';
        c.beginPath();
        c.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = 'rgb(255 200 120 / 0.55)';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(r.x, r.y);
        c.lineTo(r.x, r.y - r.vy * 0.06);
        c.stroke();
        if (r.vy >= 0 || r.y <= r.targetY) {
          explode(r);
          rockets.splice(i, 1);
        }
      }
      const drag = Math.exp(-1.7 * dt);
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]!;
        p.life += dt;
        if (p.life >= p.max) {
          sparks.splice(i, 1);
          continue;
        }
        p.vx *= drag;
        p.vy = p.vy * drag + g * 0.45 * p.heavy * dt;
        const px = p.x;
        const py = p.y;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = 1 - p.life / p.max;
        const twinkle = k < 0.35 ? 0.5 + Math.random() * 0.5 : 1;
        c.globalAlpha = Math.max(0, k ** 1.4 * twinkle);
        c.strokeStyle = p.color;
        c.lineWidth = p.size * (0.6 + 0.4 * k);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(px - (p.x - px) * 2.5, py - (p.y - py) * 2.5);
        c.lineTo(p.x, p.y);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      for (let i = confetti.length - 1; i >= 0; i--) {
        const q = confetti[i]!;
        q.sway += dt * 3;
        q.x += (q.vx + Math.sin(q.sway) * S() * 0.04) * dt;
        q.y += q.vy * dt;
        q.rot += q.vr * dt;
        if (q.y > H + 20) {
          confetti.splice(i, 1);
          continue;
        }
        c.save();
        c.translate(q.x, q.y);
        c.rotate(q.rot);
        c.scale(1, Math.cos(q.sway * 1.7));
        c.fillStyle = q.color;
        c.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
        c.restore();
      }
      if (elapsed < total || sparks.length || rockets.length || confetti.length) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      stopFireworksSound();
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} data-fireworks="" />;
}
