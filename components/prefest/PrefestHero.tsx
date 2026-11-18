'use client';

/**
 * Банер головної «до свята» (дизайн v3): заглушка стокового відео — нічне небо, силует міста й тихий феєрверк на
 * canvas, відлік до першої півночі у світі та кнопки «Додати в календар» / «Дивитися розклад». З «менше руху» —
 * лише нерухомий кадр. Шапка — окремий компонент поверх банера (звідси верхній відступ 150).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { Bar } from '@/components/skeleton/parts';
import { cn } from '@/components/primitives/cn';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { useNow } from '@/lib/time/TimeProvider';
import { clock, dayMonth } from '@/lib/prefest/format';
import { downloadIcs } from '@/lib/prefest/ics';
import { SEASON_VALUES } from '@/lib/prelaunch/season';
import { seeded, SCENE_COLORS } from './SceneCanvas';
import { useClientReady, usePrefest } from './PrefestContext';
import s from './prefest.module.css';
import h from './PrefestHero.module.css';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  l: number;
  c: string;
}

/** Нерухомий кадр: небо, силует міста, вогні. */
function paintStill(g: CanvasRenderingContext2D, w: number, hgt: number): void {
  const sky = g.createLinearGradient(0, 0, 0, hgt);
  sky.addColorStop(0, '#0A0A12');
  sky.addColorStop(1, '#22161C');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hgt);
  const r = seeded(5);
  g.fillStyle = '#07070A';
  g.beginPath();
  g.moveTo(0, hgt);
  let x = 0;
  while (x < w) {
    const bw = w * (0.015 + 0.03 * r());
    let bh = hgt * (0.08 + 0.18 * r());
    if (r() < 0.1) bh = hgt * (0.3 + 0.12 * r());
    g.lineTo(x, hgt - bh);
    g.lineTo(x + bw, hgt - bh);
    x += bw;
  }
  g.lineTo(w, hgt);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(252,226,134,.45)';
  for (let q = 0; q < 220; q++) g.fillRect(r() * w, hgt - r() * hgt * 0.22, 1.3, 1.3);
}

function HeroFx({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    let W = 1;
    let H = 1;
    let still: HTMLCanvasElement | null = null;
    let parts: Particle[] = [];
    let raf = 0;
    let visible = true;
    let last = 0;
    let nextGap = 900;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const burst = (x: number, y: number) => {
      const col = SCENE_COLORS[Math.floor(Math.random() * SCENE_COLORS.length)]!;
      const n = 70;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const sp = 1.2 + Math.random() * 2.6;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, l: 1, c: col });
      }
    };
    const frame = () => {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      if (still) g.drawImage(still, 0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.025;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.l -= 0.009;
        if (p.l <= 0) {
          parts.splice(i, 1);
          continue;
        }
        g.globalAlpha = p.l;
        g.fillStyle = p.c;
        g.beginPath();
        g.arc(p.x, p.y, 1.8, 0, 7);
        g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    };
    const stillShot = () => {
      parts = [];
      for (let k = 0; k < 5; k++)
        burst(W * (0.45 + 0.5 * Math.random()), H * (0.12 + 0.3 * Math.random()));
      for (let q = 0; q < 45; q++) frame();
    };
    const size = () => {
      W = cv.clientWidth || cv.parentElement?.clientWidth || 1520;
      H = cv.clientHeight || cv.parentElement?.clientHeight || 700;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      still = document.createElement('canvas');
      still.width = Math.round(W * dpr);
      still.height = Math.round(H * dpr);
      const sg = still.getContext('2d');
      if (sg) {
        sg.scale(dpr, dpr);
        paintStill(sg, W, H);
      }
    };
    const loop = (t: number) => {
      raf = 0;
      if (!visible) return;
      if (t - last > nextGap) {
        burst(W * (0.42 + 0.55 * Math.random()), H * (0.1 + 0.32 * Math.random()));
        last = t;
        nextGap = 900 + Math.random() * 900;
      }
      frame();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && visible && !reduced) raf = requestAnimationFrame(loop);
    };

    size();
    stillShot();
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            size();
            if (reduced) stillShot();
            else frame();
          })
        : null;
    ro?.observe(cv);
    const io =
      !reduced && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
            if (visible) start();
            else if (raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
          })
        : null;
    io?.observe(cv);
    start();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro?.disconnect();
      io?.disconnect();
    };
  }, [reduced]);
  return <canvas ref={ref} className={h.fx} aria-hidden="true" />;
}

/** Відео й фото банера — на всю площу, завжди по центру на будь-якій ширині (рішення власника 2026-11-18). */
const HERO_MEDIA_FIT = { objectFit: 'cover', objectPosition: 'center' } as const;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

type Unit = 'days' | 'hours' | 'minutes' | 'seconds';

export function PrefestHero() {
  const t = useTranslations('prefest.hero');
  const tRoot = useTranslations('prefest');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const reduced = useReducedMotion();
  const now = useNow();
  const media = site?.media.hero;
  const known = ready && now > 0;
  const first = model.firstMidnightMs;
  const secs = Math.max(0, Math.floor((first - now) / 1000));
  const started = known && first <= now;

  const days = Math.floor(secs / 86400);
  const hrs = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  const boxes: { n: number; text: string; key: Unit }[] = [
    { n: days, text: String(days), key: 'days' },
    { n: hrs, text: pad(hrs), key: 'hours' },
    { n: mins, text: pad(mins), key: 'minutes' },
    { n: sec, text: pad(sec), key: 'seconds' },
  ];
  const when = ready ? tRoot('dateAt', { date: dayMonth(first), time: clock(first) }) : '';
  const bold = (c: ReactNode) =>
    ready ? (
      <b>{c}</b>
    ) : (
      <span className={h.skInline} aria-hidden="true">
        <Bar w={112} h={15} />
      </span>
    );

  return (
    <section className={h.hero} aria-label={t('aria')}>
      {media?.kind === 'video' ? (
        <video
          className={h.fx}
          src={media.src}
          poster={media.poster}
          autoPlay={!reduced}
          muted
          loop
          playsInline
          aria-hidden="true"
          style={HERO_MEDIA_FIT}
        />
      ) : media ? (
        // eslint-disable-next-line @next/next/no-img-element -- статичний експорт
        <img className={h.fx} src={media.src} alt="" style={HERO_MEDIA_FIT} />
      ) : (
        <HeroFx reduced={reduced} />
      )}
      {site ? (
        media ? null : (
          <span hidden data-media-placeholder="hero" />
        )
      ) : (
        <span className={h.stock}>{t('stock')}</span>
      )}
      <div className={cn(s.wrap, h.inner)}>
        <div className={h.copy}>
          {site ? (
            // Мовне дерево (рішення власника 2026-11-18): рядок над заголовком — частина H1 зі словами пошуку.
            <h1>
              <span className={cn(h.eyebrow, h.eyebrowInH1)}>{t('eyebrow', SEASON_VALUES)}</span>{' '}
              {t('titleStart')} <em>{t('titleEm')}</em>
            </h1>
          ) : (
            <>
              <p className={h.eyebrow}>
                <i aria-hidden="true" />
                {t('eyebrow')}
              </p>
              <h1>
                {t('titleStart')} <em>{t('titleEm')}</em>
              </h1>
            </>
          )}
          <p className={h.lead}>
            {t('lead')} <b>{t('leadFree')}</b>
          </p>
          <div className={cn(s.cta, h.ctaRow)}>
            <button
              type="button"
              className={cn(s.btn, s.btnCoral)}
              onClick={() =>
                downloadIcs(
                  {
                    uid: 'time2fest-first-midnight-2027',
                    title: t('calendarTitle'),
                    description: t('calendarText'),
                    startMs: first,
                  },
                  site ? 'time2fest-new-year.ics' : 'time2fest-novyi-rik.ics',
                )
              }
            >
              <Icon name="calendar-add" size={20} />
              {t('addCalendar')}
            </button>
            <a className={cn(s.btn, s.btnGhost)} href="#schedule">
              {t('seeSchedule')}
            </a>
          </div>
        </div>
        <div className={h.cdBox}>
          <span className={h.cdLabel}>{t('countdownLabel')}</span>
          {started ? (
            <p className={h.cdLabel} role="timer" aria-live="off">
              {t('started')}
            </p>
          ) : (
            <div
              className={h.cd}
              role="timer"
              aria-live="off"
              aria-label={
                known ? t('countdownSpoken', { days, hours: hrs, minutes: mins }) : undefined
              }
            >
              {boxes.map((x) => (
                <div key={x.key} className={h.cdItem}>
                  <b className={cn(h.cdNum, !known && h.cdNumSk)}>
                    {known ? x.text : <Bar w="58%" h="100%" />}
                  </b>
                  <span className={h.cdUnit}>{t(x.key, { count: known ? x.n : 5 })}</span>
                </div>
              ))}
            </div>
          )}
          <span className={h.cdWhere}>{t.rich('countdownWhere', { when, b: bold })}</span>
        </div>
      </div>
    </section>
  );
}
