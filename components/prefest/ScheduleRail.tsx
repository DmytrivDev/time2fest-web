'use client';

/* eslint-disable react-hooks/refs, react-hooks/immutability -- слайдер рухає DOM напряму через контролер (SnapController): 60 кадрів/с без перерендеру */

/**
 * «Розклад свята» (дизайн v3): панель, що налізає на низ банера, зі слайдером карток — головні місця святкування.
 * Слайдер без рідної прокрутки: трек зсувається `transform`, стрілки гортають по 3 картки, перетягування мишею й
 * пальцем із доводкою до краю картки, гумові краї, клавіші ←/→. Математика доводки — `lib/prefest/slider`.
 */
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { Flag } from '@/components/primitives/Flag';
import { Bar } from '@/components/skeleton/parts';
import { cn } from '@/components/primitives/cn';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { clock, dayMonth, viewerZoneName } from '@/lib/prefest/format';
import { downloadIcs } from '@/lib/prefest/ics';
import { progressBar, rubberBand, snapPosition } from '@/lib/prefest/slider';
import type { MainCelebration } from '@/lib/prefest/model';
import { viewerTimeZone } from '@/lib/i18n/time';
import { MediaSlot } from './SceneCanvas';
import { useClientReady, usePrefest } from './PrefestContext';
import s from './prefest.module.css';
import r from './ScheduleRail.module.css';

const GAP = 16;
const DRAG_START_PX = 6;

interface SliderUi {
  canPrev: boolean;
  canNext: boolean;
  dragging: boolean;
  live: boolean;
}

/** Стан і DOM слайдера поза React-рендером: трек рухається напряму (60 кадрів/с під час перетягування). */
class SnapController {
  slider: HTMLDivElement | null = null;
  track: HTMLDivElement | null = null;
  bar: HTMLElement | null = null;
  reduced = false;
  moved = false;
  private pos = 0;
  private drag: { x: number; p: number; vx: number; lx: number; lt: number; id: number } | null =
    null;
  constructor(private readonly setUi: (patch: Partial<SliderUi>) => void) {}

  private maxPos(): number {
    return this.slider && this.track
      ? Math.max(0, this.track.scrollWidth - this.slider.clientWidth)
      : 0;
  }
  private step(): number {
    const c = this.track?.children[0] as HTMLElement | undefined;
    return c ? c.getBoundingClientRect().width + GAP : 300;
  }
  render(anim: boolean): void {
    const sl = this.slider;
    const tr = this.track;
    if (!sl || !tr) return;
    tr.style.transition =
      anim && !this.reduced ? 'transform .45s cubic-bezier(.2,.7,.2,1)' : 'none';
    tr.style.transform = `translate3d(${-this.pos}px,0,0)`;
    const mx = this.maxPos();
    const bar = progressBar(this.pos, mx, sl.clientWidth, tr.scrollWidth);
    if (this.bar) {
      this.bar.style.width = `${bar.widthPct}%`;
      this.bar.style.left = `${bar.leftPct}%`;
    }
    this.setUi({ live: !anim, canPrev: this.pos > 1, canNext: this.pos < mx - 1 });
  }
  snap(target: number): void {
    this.pos = snapPosition(target, this.step(), this.maxPos());
    this.render(true);
  }
  resnap = (): void => this.snap(this.pos);
  prev(): void {
    this.snap(this.pos - this.step() * 3);
  }
  next(): void {
    this.snap(this.pos + this.step() * 3);
  }
  down(e: PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
    this.drag = {
      x: e.clientX,
      p: this.pos,
      vx: 0,
      lx: e.clientX,
      lt: performance.now(),
      id: e.pointerId,
    };
    this.moved = false;
  }
  move(e: PointerEvent<HTMLDivElement>): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!this.moved && Math.abs(dx) > DRAG_START_PX) {
      this.moved = true;
      try {
        this.slider?.setPointerCapture(d.id);
      } catch {
        /* вказівник уже не активний */
      }
      this.setUi({ dragging: true });
    }
    if (!this.moved) return;
    const now = performance.now();
    d.vx = (e.clientX - d.lx) / Math.max(1, now - d.lt);
    d.lx = e.clientX;
    d.lt = now;
    this.pos = rubberBand(d.p - dx, this.maxPos());
    this.render(false);
  }
  up(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.setUi({ dragging: false });
    if (this.moved) this.snap(this.pos - d.vx * 220);
  }
  clickCapture(e: MouseEvent): void {
    if (this.moved) {
      e.preventDefault();
      e.stopPropagation();
      this.moved = false;
    }
  }
  key(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      this.snap(this.pos + this.step());
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      this.snap(this.pos - this.step());
    }
  }
  /** Фокус із клавіатури на картці поза кадром: браузер не прокручує — доводимо картку в кадр самі. */
  focus(e: FocusEvent<HTMLDivElement>): void {
    const sl = this.slider;
    if (!sl) return;
    sl.scrollLeft = 0;
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-card]');
    if (!card) return;
    const left = card.offsetLeft;
    if (left < this.pos || left + card.offsetWidth > this.pos + sl.clientWidth) this.snap(left);
  }
}

function useSnapSlider(reduced: boolean) {
  const [ui, setUiState] = useState<SliderUi>({
    canPrev: false,
    canNext: true,
    dragging: false,
    live: false,
  });
  const [ctl] = useState(
    () => new SnapController((patch) => setUiState((u) => ({ ...u, ...patch }))),
  );
  useEffect(() => {
    ctl.reduced = reduced;
  }, [ctl, reduced]);
  const mount = useCallback(
    (slider: HTMLDivElement | null) => {
      ctl.slider = slider;
    },
    [ctl],
  );
  const mountTrack = useCallback(
    (track: HTMLDivElement | null) => {
      ctl.track = track;
    },
    [ctl],
  );
  const mountBar = useCallback(
    (bar: HTMLElement | null) => {
      ctl.bar = bar;
    },
    [ctl],
  );
  useEffect(() => {
    const sl = ctl.slider;
    if (!sl) return;
    ctl.render(false);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(ctl.resnap) : null;
    ro?.observe(sl);
    window.addEventListener('resize', ctl.resnap);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', ctl.resnap);
    };
  }, [ctl]);
  return { ctl, ui, mount, mountTrack, mountBar };
}

const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
};
/** «Лос-Анджелес» → «los-anzhelec» без кирилиці: uid події — лише ASCII. */
function asciiSlug(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const InlineBar = ({ w, h }: { w: number; h: number }) => (
  <span className={r.skInline} aria-hidden="true">
    <Bar raised w={w} h={h} />
  </span>
);

const SLOT = '';
/** Вставити вузол (скелетон) у місце `{плейсхолдера}` перекладу, який не приймає вузлів. */
function withNode(text: string, node: ReactNode): ReactNode {
  const [a = '', b = ''] = text.split(SLOT);
  return (
    <>
      {a}
      {node}
      {b}
    </>
  );
}

export function ScheduleRail() {
  const t = useTranslations('prefest.schedule');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const reduced = useReducedMotion();
  const sl = useSnapSlider(reduced);

  const calendar = (c: MainCelebration) =>
    downloadIcs(
      {
        uid: `time2fest-${c.zoneId}-${asciiSlug(c.city)}`,
        title: t('calendarTitle', { city: c.city }),
        description: t('calendarText', { city: c.city, place: c.place }),
        startMs: c.midnightMs,
      },
      `time2fest-${asciiSlug(c.city)}.ics`,
    );

  return (
    <section className={r.sched} id="schedule" aria-labelledby="prefest-sched-h">
      <div className={s.wrap}>
        <div className={r.panel}>
          <div className={cn(s.secHead, r.head)}>
            <h2 id="prefest-sched-h">
              {t('title')}
              <span className={r.tz}>
                {ready
                  ? site
                    ? site.zoneCity(viewerTimeZone())
                      ? t('tzNamed', { tz: site.zoneCity(viewerTimeZone()) })
                      : t('tz')
                    : t('tzNamed', { tz: viewerZoneName() })
                  : withNode(
                      t('tzNamed', { tz: SLOT }),
                      <span className={r.skInline} aria-hidden="true">
                        <Bar w={96} h={14} />
                      </span>,
                    )}
              </span>
            </h2>
            <div className={r.right}>
              <a className={s.link} href="#map">
                {t('allZones')} <span aria-hidden="true">›</span>
              </a>
              <div className={r.arrows}>
                <button
                  type="button"
                  className={s.roundBtn}
                  aria-label={t('prev')}
                  disabled={!sl.ui.canPrev}
                  onClick={() => sl.ctl.prev()}
                >
                  <Icon name="chevron-left" size={18} />
                </button>
                <button
                  type="button"
                  className={s.roundBtn}
                  aria-label={t('next')}
                  disabled={!sl.ui.canNext}
                  onClick={() => sl.ctl.next()}
                >
                  <Icon name="chevron-right" size={18} />
                </button>
              </div>
            </div>
          </div>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- перетягування — додаток для миші й пальця; з клавіатури працюють стрілки та кнопки */}
          <div
            ref={sl.mount}
            className={cn(r.slider, sl.ui.dragging && r.drag)}
            role="group"
            aria-label={t('sliderLabel')}
            onPointerDown={(e) => sl.ctl.down(e)}
            onPointerMove={(e) => sl.ctl.move(e)}
            onPointerUp={() => sl.ctl.up()}
            onPointerCancel={() => sl.ctl.up()}
            onClickCapture={(e) => sl.ctl.clickCapture(e)}
            onKeyDown={(e) => sl.ctl.key(e)}
            onFocusCapture={(e) => sl.ctl.focus(e)}
          >
            <div ref={sl.mountTrack} className={r.track}>
              {model.celebrations.map((c, i) => {
                const country = model.countriesByIso.get(c.iso);
                const href = country?.described ? country.href : null;
                const who = (
                  <>
                    <Flag code={c.flagCode} diameter={20} decorative />
                    {c.city}
                  </>
                );
                return (
                  <div key={`${c.zoneId}-${c.city}`} className={r.ev} data-card>
                    <div className={r.ph}>
                      <MediaSlot slot={c.mediaSlot} item={site?.media[c.mediaSlot]} mark={Boolean(site)} seed={i} bursts={3} />
                      {site ? null : <span className={cn(s.chip, r.chipPos)}>{t('stockChip')}</span>}
                      <button
                        type="button"
                        className={r.cal}
                        aria-label={t('calAria', { city: c.city })}
                        onClick={() => calendar(c)}
                      >
                        <Icon name="calendar" size={16} />
                      </button>
                    </div>
                    <div className={r.body}>
                      <span className={r.who}>
                        {href ? (
                          <NextLink
                            href={href}
                            className={cn(r.cityLink, 't2f-focus')}
                            draggable={false}
                          >
                            {who}
                          </NextLink>
                        ) : (
                          who
                        )}
                      </span>
                      <span className={r.time}>
                        {ready ? clock(c.midnightMs) : <Bar raised w={84} h={[29, 33, 33]} />}
                      </span>
                      <span className={r.sub}>
                        {ready
                          ? t('sub', { date: dayMonth(c.midnightMs), place: c.place })
                          : withNode(
                              t('sub', { date: SLOT, place: c.place }),
                              <InlineBar w={64} h={12} />,
                            )}
                      </span>
                      <span className={r.tag}>
                        <Icon name="sparkles" size={15} />
                        {t('tag')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className={cn(r.sprog, sl.ui.live && r.live)} aria-hidden="true">
            <i ref={sl.mountBar} />
          </div>
        </div>
      </div>
    </section>
  );
}
