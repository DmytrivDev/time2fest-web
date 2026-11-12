'use client';

/**
 * Свято штампа в шапці — вигляд (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header` v2, рішення власника 2026-11-12: A + E).
 * Усе — строго в межах шапки (64 px десктоп, 56 px телефон): золото, іскри, печатка й її політ. Нижче шапки нічого не
 * опускається, плеєр не перекривається, висота шапки не змінюється — міняється лише вміст.
 *
 * - `CelebrationBackdrop` — золото на всю ширину шапки: заливка зліва направо за 0,4 с, іскри всередині шапки
 *   (кожна мерехтить повільніше за раз на секунду — разом не частіше 3 разів на секунду), «Зменшити рух» — без руху.
 * - `CelebrationContent` — одна кнопка (клік по золотій шапці й «Подивитися штамп ↓» — те саме: прокрутити до картки
 *   під плеєром і поставити на неї фокус). Десктоп — один рядок: печатка · «З Новим роком, Франція!» · «✓ Штамп у
 *   паспорті» · «Подивитися штамп ↓»; телефон — печатка й два рядки. Довга назва, що не влазить, — коротка форма з дошки.
 * - 8–9,2 с печатка зменшується й летить до аватара (гостю — до значка кабінету); текст гасне.
 */
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/components/primitives/cn';
import { roundFlagSrc } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import {
  deskWords,
  isLongName,
  phoneWords,
  type Celebration,
  type CelebrationPhase,
  type Msg,
} from '@/lib/stamp/stampCelebration';
import s from './celebration.module.css';

export interface HeaderCelebrationProps {
  celebration: Pick<Celebration, 'id' | 'kind' | 'stamps'>;
  phase: CelebrationPhase;
  reduced: boolean;
  paused: boolean;
  /** Гість без акаунта: «Штамп на цьому пристрої», печатка летить до значка кабінету. */
  guest: boolean;
  /** Клік по золотій шапці чи «Подивитися штамп». */
  onActivate?: () => void;
}

/**
 * Іскри (позиції у %, щоб однаково лягали на будь-якій ширині); `star` — чотирипроменева, інакше крапка.
 * Де текст (13–78 % ширини, як на дошці) — лише дрібні бліді крапки, щоб не заважати читати.
 */
const TEXT_ZONE = [13, 78] as const;
const SPARKS = [
  [3, 22, 4, 'dot', '#fff'], [7, 70, 10, 'star', '#fff'], [11, 35, 3, 'dot', '#c8901f'], [15, 80, 5, 'dot', '#e5484d'],
  [19, 15, 12, 'star', '#b9821c'], [24, 60, 4, 'dot', '#7a5a10'], [29, 28, 3, 'dot', '#fff'], [34, 78, 10, 'star', '#e5484d'],
  [39, 12, 4, 'dot', '#c8901f'], [44, 66, 3, 'dot', '#fff'], [49, 30, 5, 'dot', '#e5484d'], [54, 74, 12, 'star', '#fff'],
  [59, 18, 3, 'dot', '#7a5a10'], [63, 58, 4, 'dot', '#fff'], [68, 26, 10, 'star', '#b9821c'], [73, 76, 5, 'dot', '#c8901f'],
  [78, 40, 3, 'dot', '#e5484d'], [83, 14, 4, 'dot', '#fff'], [88, 64, 12, 'star', '#fff'], [93, 30, 3, 'dot', '#c8901f'],
  [97, 72, 4, 'dot', '#e5484d'],
] as const;

export function CelebrationBackdrop({ reduced }: Pick<HeaderCelebrationProps, 'reduced'>) {
  return (
    <span aria-hidden="true" className={s.backdrop} data-celebration-backdrop="">
      <span className={s.gold} />
      {reduced ? null : (
        <>
          <span className={s.edge} />
          <span className={s.sparks}>
            {SPARKS.map(([x, y, size, kind, color], i) => {
              const pale = x >= TEXT_ZONE[0] && x <= TEXT_ZONE[1];
              const star = kind === 'star' && !pale;
              return (
              <span
                key={i}
                className={cn(star ? s.star : s.dot, pale && s.pale)}
                style={{ left: `${x}%`, top: `${y}%`, '--size': `${(pale ? Math.min(size, 4) : size) / 16}rem`, '--tone': color, '--twinkle': `${1600 + (i % 5) * 250}ms`, '--delay': `${(i % 7) * 230}ms` } as CSSProperties}
              >
                {star ? (
                  <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
                    <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" fill="currentColor" />
                  </svg>
                ) : null}
              </span>
              );
            })}
          </span>
        </>
      )}
    </span>
  );
}

/** Печатка: подвійне кільце (суцільне й пунктирне) і круглий прапор; кілька — віялом. */
function Seals({ codes, size }: { codes: string[]; size: 'desk' | 'phone' | 'phoneMulti' }) {
  return (
    <span className={cn(s.seals, s[size])}>
      {codes.slice(0, 3).map((code, i) => {
        const src = roundFlagSrc(code);
        return (
          <span key={code + i} className={s.seal} style={{ '--rot': `${-10 + i * 14}deg`, '--i': i } as CSSProperties}>
            <span className={s.sealRing} />
            {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт, SVG прапора */}
            {src ? <img src={src} alt="" className={s.sealFlag} /> : null}
          </span>
        );
      })}
    </span>
  );
}

export function CelebrationContent({ celebration, phase, guest, onActivate }: HeaderCelebrationProps) {
  const tr = useTranslations('header.celebration') as unknown as (key: string, params?: Record<string, string | number>) => string;
  const r = (m: Msg) => tr(m.key, m.params);
  const first = celebration.stamps[0];
  const single = celebration.kind === 'now' && celebration.stamps.length === 1;
  // Коротка форма: довга назва (запасний поріг) або вимір показав, що рядок не влазить.
  const [shortDesk, setShortDesk] = useState(() => single && !!first && isLongName(first.country, 'desk'));
  const [shortPhone, setShortPhone] = useState(() => single && !!first && isLongName(first.country, 'phone'));
  const deskMain = useRef<HTMLSpanElement>(null);
  const phoneLine = useRef<HTMLSpanElement>(null);
  const root = useRef<HTMLButtonElement>(null);
  const [fly, setFly] = useState<{ x: number; y: number } | null>(null);

  // Вимір рядка: не влазить — коротка форма з дошки.
  useLayoutEffect(() => {
    if (!single) return;
    const over = (el: HTMLElement | null) => !!el && el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1;
    if (!shortDesk && over(deskMain.current)) setShortDesk(true);
    if (!shortPhone && over(phoneLine.current)) setShortPhone(true);
  }, [single, shortDesk, shortPhone, celebration.id]);

  // Політ печатки: від її місця до аватара (гостю — до значка кабінету), у межах шапки.
  useLayoutEffect(() => {
    if (phase !== 'fly' || fly) return;
    const header = root.current?.closest('header');
    const seal = [...(root.current?.querySelectorAll<HTMLElement>('[data-celebration-seals]') ?? [])].find((el) => el.offsetParent !== null);
    const target = header?.querySelector<HTMLElement>('[data-header-account] [data-header-avatar], [data-header-account] svg, [data-header-account]');
    if (!seal || !target) return;
    const a = seal.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    setFly({ x: b.left + b.width / 2 - (a.left + a.width / 2), y: b.top + b.height / 2 - (a.top + a.height / 2) });
  }, [phase, fly]);

  if (!first) return null;
  const codes = celebration.stamps.map((x) => x.flagCode);
  const desk = deskWords(celebration, { guest, short: shortDesk });
  const phone = phoneWords(celebration, { guest, short: shortPhone });
  const flyStyle = fly ? ({ '--fly-x': `${fly.x}px`, '--fly-y': `${fly.y}px` } as CSSProperties) : undefined;

  return (
    <button
      ref={root}
      type="button"
      onClick={onActivate}
      data-celebration-content=""
      data-kind={celebration.kind}
      className={cn('t2f-focus', s.content)}
    >
      {/* Десктоп і планшет: один рядок. */}
      <span className={s.desk}>
        <span data-celebration-seals="" className={s.flyer} style={flyStyle}>
          <Seals codes={codes} size="desk" />
        </span>
        <span className={s.text}>
          {desk.lead ? <span className={s.lead}>{r(desk.lead)}</span> : null}
          <span ref={deskMain} className={cn(s.main, celebration.kind !== 'now' && s.mainCatch)}>
            {r(desk.main)}
          </span>
          <span aria-hidden="true" className={s.dotSep} />
          <span className={s.tail}>
            {desk.check ? <Icon name="check" size={18} strokeWidth={2.4} /> : null}
            <span className={s.tailText}>{r(desk.tail)}</span>
          </span>
        </span>
        <span className={s.see}>
          <span className={s.seeLabel}>{r(desk.see)}</span>
          <Icon name="arrow-down" size={16} strokeWidth={2.2} />
        </span>
      </span>
      {/* Телефон: печатка й два рядки (коротка форма з дошки). */}
      <span className={s.phone}>
        <span data-celebration-seals="" className={s.flyer} style={flyStyle}>
          <Seals codes={codes} size={codes.length > 1 ? 'phoneMulti' : 'phone'} />
        </span>
        <span className={s.lines}>
          <span ref={phoneLine} className={s.line1}>
            {r(phone.line1)}
          </span>
          <span className={s.line2}>{r(phone.line2)}</span>
        </span>
      </span>
    </button>
  );
}
