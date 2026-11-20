'use client';

/**
 * Передстартовий сайт: превʼю картки «Запрошення на новорічну ніч» (рішення власника 2026-11-20) — той самий кадр
 * 1080×1920, що йде в PNG для поширення (`lib/prefest/invite.ts`), зменшений до ширини колонки. До гідратації (країна
 * й пояс ще невідомі) — порожня рамка тієї ж розкладки.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { roundFlagSrc } from '@/components/primitives/Flag';
import { cn } from '@/components/primitives/cn';
import { drawInvite, INVITE_H, INVITE_W, ukOrdinalFemSuffix, type InviteParams, type InviteTexts } from '@/lib/prefest/invite';
import { SEASON_YEAR } from '@/lib/prelaunch/season';
import m from './StoryCard.module.css';

export interface InviteVars {
  /** Номер моєї півночі (1…total). */
  n: number;
  total: number;
  hours: number;
  country: { name: string; flagCode: string };
  /** «1 січня, 00:00» — моя північ за часом відвідувача. */
  mineWhen: string;
  /** Перша північ (Кіритіматі) за часом відвідувача: дата, час і місто його пояса (порожньо — без міста). */
  start: { date: string; time: string; city: string };
}

/** Тексти картки мовою сторінки. */
export function useInviteTexts(v: InviteVars | null): InviteTexts | null {
  const t = useTranslations('prefest.mine.invite');
  if (!v) return null;
  const midnights = t('midnights', { count: v.total });
  return {
    title1: t('title1'),
    title2: t('title2'),
    night: t('night'),
    year: String(SEASON_YEAR),
    tagline: t('tagline', { hours: t('hours', { count: v.hours }), midnights }),
    scaleFirst: t('scaleNo', { n: 1 }),
    scaleLast: t('scaleNo', { n: v.total }),
    scaleMine: t('scaleNo', { n: v.n }),
    mineLabel: t('mine'),
    ord: t('ord', { n: v.n, s: ukOrdinalFemSuffix(v.n) }),
    country: v.country.name,
    mineWhen: v.mineWhen,
    startLabel: t('start'),
    startWhen: v.start.city ? t('startCity', v.start) : t('startNoCity', { date: v.start.date, time: v.start.time }),
    startSub: t('startSub'),
    free: `${t('free')} `,
    site: 'time2fest.com',
    sealTop: t('sealTop'),
    sealBottom: midnights.toLocaleUpperCase(),
    footer: `${t('footer', { midnights })} `,
  };
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = images.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Шрифт сторінки (Manrope) з потрібними накресленнями — до малювання на canvas. */
async function pageFont(): Promise<string> {
  const family = getComputedStyle(document.body).fontFamily || 'Manrope, system-ui, sans-serif';
  await document.fonts.ready;
  await Promise.all(['700', '800'].map((w) => document.fonts.load(`${w} 40px ${family}`, 'Aа№').catch(() => [])));
  return family;
}

/** Параметри кадру: тексти + завантажені прапор, логотип і шрифт. */
export async function inviteParams(texts: InviteTexts, v: InviteVars): Promise<InviteParams> {
  const flagSrc = roundFlagSrc(v.country.flagCode);
  const [fontFamily, flag, logo] = await Promise.all([
    pageFont(),
    flagSrc ? loadImage(flagSrc) : Promise.resolve(null),
    loadImage('/brand/logo.png'),
  ]);
  return { texts, total: v.total, mine: v.n, flag, logo, fontFamily };
}

export function InviteCard({ vars, texts, action }: { vars: InviteVars | null; texts: InviteTexts | null; action: ReactNode }) {
  const t = useTranslations('prefest.mine.invite');
  const ref = useRef<HTMLCanvasElement>(null);
  // Сторінка перемальовується щосекунди (відлік) — кадр лише коли змінились самі дані картки.
  const key = vars && texts ? JSON.stringify([vars, texts]) : '';
  useEffect(() => {
    if (!key) return;
    const [v, tx] = JSON.parse(key) as [InviteVars, InviteTexts];
    let live = true;
    void inviteParams(tx, v).then((p) => {
      const g = ref.current?.getContext('2d');
      if (live && g) drawInvite(g, p);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return (
    <div className={cn(m.wrap, m.wrapTop)}>
      <div
        className={cn(m.story, m.storyWide)}
        role="img"
        aria-label={vars && texts ? t('aria', { ord: texts.ord, country: vars.country.name }) : t('title1')}
      >
        <canvas ref={ref} className={m.canvas} width={INVITE_W} height={INVITE_H} hidden={!vars} />
      </div>
      <div className={m.action}>{action}</div>
    </div>
  );
}
