/**
 * Примітиви скелетонів сторінок (2026-11-10, правка власника: «скелетон кожної сторінки повторює стартову розкладку»).
 * Без хуків і без `'use client'`: їх рендерить і серверний `loading.tsx` (не чекає JS сторінки), і клієнтський код.
 * Розміри задаємо в px макета, а в стиль пишемо rem (пропорційний макет, кегель кореня залежить від ширини):
 * число — для всіх макетів, масив `[телефон, планшет-портрет, альбом/десктоп]` — окремо (пропуск = як наступний / попередній).
 */
import type { CSSProperties, ReactNode } from 'react';
import s from './skeleton.module.css';

/**
 * Заливка з відблиском — як у `Skeleton` (`.t2f-shine`, primitives.css). `cn` і `Skeleton` сюди не імпортуємо: `cn.ts`
 * імпортує primitives.css, і в чанку `loading.tsx` службових сторінок він ставав раніше за модулі сторінки — мінявся
 * каскад самої сторінки (на `/pass/`). primitives.css і так уже завантажений шапкою чи попередньою сторінкою.
 */
const SKELETON_BASE = 't2f-shine relative overflow-hidden bg-surface';

/** Склеїти класи (без `cn` — див. вище). */
export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

/** Розмір у px: один для всіх макетів або `[телефон, планшет-портрет, альбом/десктоп]`. */
export type Px = number | string | readonly [number | string, (number | string)?, (number | string)?];

const rem = (v: number | string) => (typeof v === 'number' ? `${v / 16}rem` : v);

/**
 * CSS-змінні `--h`, `--ht`, `--hw` (і так само для інших) з `Px`. Задаємо завжди всі три (і значення за замовчуванням,
 * коли розмір не вказано): власні властивості успадковуються, і без цього брусок брав би висоту чи відступ картки-батька.
 */
function vars(name: string, v: Px | undefined, out: Record<string, string>, def: string) {
  const [p, t, w] = v === undefined ? [def] : Array.isArray(v) ? v : [v as number | string];
  const phone = p === undefined ? def : rem(p);
  out[`--${name}`] = phone;
  out[`--${name}t`] = t !== undefined ? rem(t) : w !== undefined ? rem(w) : phone;
  out[`--${name}w`] = w !== undefined ? rem(w) : phone;
}

export interface SizeProps {
  /** Висота. */
  h?: Px;
  /** Ширина (за замовчуванням 100 %; рядок — напр. `'60%'`). */
  w?: Px;
  /** Відступ згори. */
  mt?: Px;
}

function style({ h, w, mt }: SizeProps, extra?: Record<string, string>, defH = '1rem'): CSSProperties {
  const out: Record<string, string> = { ...extra };
  vars('h', h, out, defH);
  vars('w', w, out, '100%');
  vars('mt', mt, out, '0rem');
  return out as CSSProperties;
}

type Shape = 'line' | 'btn' | 'card' | 'pill';

/** Брусок із відблиском. `raised` — усередині картки (світліший). */
export function Bar({ shape = 'line', raised, className, ...size }: SizeProps & { shape?: Shape; raised?: boolean; className?: string }) {
  return <span aria-hidden="true" className={cx(SKELETON_BASE, s.box, s[shape], raised && s.raised, className)} style={style(size)} />;
}

/** Картка з рамкою; всередині — бруски `raised`. `p` — внутрішні поля. */
export function Frame({ children, p, className, ...size }: SizeProps & { p?: Px; children?: ReactNode; className?: string }) {
  const extra: Record<string, string> = {};
  vars('p', p, extra, '1rem');
  return (
    <div aria-hidden="true" className={cx(s.frame, className)} style={style(size, extra, 'auto')}>
      {children}
    </div>
  );
}

/** Ряд брусків (flex, по центру); `g` — проміжок. */
export function Row({ children, g, mt, h, inset, className }: { children: ReactNode; g?: number; mt?: Px; h?: Px; inset?: 'page' | 'bar'; className?: string }) {
  const extra: Record<string, string> = {};
  if (g !== undefined) extra['--g'] = rem(g);
  return (
    <div className={cx(s.row, inset === 'page' && s.inset, inset === 'bar' && s.insetBar, className)} style={style({ mt, h }, extra, 'auto')}>
      {children}
    </div>
  );
}

/** Сітка карток: `cols` — `[телефон, планшет-портрет, альбом/десктоп]`. */
export function Grid({ children, cols, g, mt }: { children: ReactNode; cols: readonly [number, number?, number?]; g?: number; mt?: Px }) {
  const extra: Record<string, string> = {
    '--cols': String(cols[0]),
    '--colst': String(cols[1] ?? cols[2] ?? cols[0]),
    '--colsw': String(cols[2] ?? cols[0]),
  };
  if (g !== undefined) extra['--g'] = rem(g);
  return (
    <div className={s.wrapGrid} style={style({ mt }, extra)}>
      {children}
    </div>
  );
}

/** Блок із полями сторінки з плеєром (телефон 16, планшет-портрет 32, ширше — без полів). */
export function Inset({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(s.inset, className)}>{children}</div>;
}

/** Розтягується на решту рядка. */
export function Grow({ children }: { children?: ReactNode }) {
  return <span className={s.grow}>{children}</span>;
}

/** Показати лише на телефоні / планшеті-портреті / альбомі й десктопі (або всюди, крім). */
export function Only({ on, children }: { on: 'phone' | 'tp' | 'wide' | 'desk' | 'not-phone' | 'not-tp' | 'not-wide'; children: ReactNode }) {
  const cls = { phone: s.onlyPhone, tp: s.onlyTp, wide: s.onlyWide, desk: s.onlyDesk, 'not-phone': s.notPhone, 'not-tp': s.notTp, 'not-wide': s.notWide }[on];
  return <div className={cls}>{children}</div>;
}

/** Плеєр 16:9 (≥ 200 px). `data-sk-player` — макет `(live)` не додає полів сторінки без плеєра (планшет-портрет). */
export function PlayerBar() {
  return <span aria-hidden="true" data-sk-player="" className={cx(SKELETON_BASE, s.player)} />;
}

/** Згорнутий чат унизу (телефон і планшет-портрет) — там, де стане `ChatDock`. */
export function DockBar() {
  return (
    <div aria-hidden="true" className={s.dock}>
      <span className={s.dockHandle} />
      <Row>
        <Bar w={20} h={20} />
        <Bar w={120} h={18} />
        <Grow />
        <Bar shape="pill" w={64} h={24} />
      </Row>
    </div>
  );
}

/** Плаваюча смуга розділів кабінету (телефон і планшет-портрет). */
export function FloatBar() {
  return <span aria-hidden="true" className={cx(SKELETON_BASE, s.floatBar)} />;
}

export interface SkeletonRootProps {
  /** Маркер сторінки: `data-skeleton` (той самий у `loading.tsx` і в стані сторінки до готовності). */
  kind: string;
  /** Текст для зчитувача (`role="status"`). */
  label: string;
  /** Поля сторінки без плеєра на телефоні. */
  pad?: boolean;
  /** Згорнутий чат унизу на телефоні й планшеті-портреті. */
  dock?: boolean;
  className?: string;
  children: ReactNode;
}

/** Обгортка скелетона: `aria-busy`, текст для зчитувача, маркер `data-skeleton`. */
export function SkeletonRoot({ kind, label, pad, dock, className, children }: SkeletonRootProps) {
  return (
    <div aria-busy="true" data-skeleton={kind} className={cx(s.root, pad && s.pad, className)}>
      <span role="status" className="sr-only">
        {label}
      </span>
      {children}
      {dock ? <DockBar /> : null}
    </div>
  );
}

/** Заголовок сторінки без плеєра: h1 і підзаголовок (телефон 28/20, ширше 37/23 — як справжні). */
export function TitleBars({ w = [220, 300, 340], sub = [300, 520, 560], subH = [20, 23, 23] }: { w?: Px; sub?: Px; subH?: Px }) {
  return (
    <>
      <Bar h={[28, 37, 37]} w={w} />
      <Bar h={subH} w={sub} mt={[8, 6, 6]} />
    </>
  );
}
