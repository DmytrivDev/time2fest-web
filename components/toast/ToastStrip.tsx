'use client';

/**
 * Смуга тостів — одна на весь сайт (тости загальні, без прив’язки до міста): головна, сторінка країни, кімната, там, де
 * жила смуга «Першого ряду» (рішення власника 2026-11-12; дошки `Desk-Toast-New`, `Phone-Toast-New` v2).
 * - Телефон (`variant="phone"`): рядок під рядком часу — прапор, нік, тост у рядок, шпилька для закріплених, шеврон;
 *   коротка «Тост». Тост у рядку змінюється кожні ≈6 с (спершу закріплені, потім найновіші). Дотик до рядка — список у
 *   потоці (плавно): «Закріплені до наступної півночі», «Щойно», «Сказати тост», «Усі тости в чаті «Світ»». Порожньо —
 *   уся смуга одна кнопка «Тостів ще немає — скажи перший».
 * - Десктоп (`variant="desk"`): нейтральна картка під рядком дій плеєра — келих, «Тости світу», лічильники, ‹ N / M ›,
 *   шеврон, «Сказати тост»; нижче — ОДИН тост цілим текстом (прапор, нік, «закріплено до HH:MM»), змінюється кожні
 *   ≈6 с з тонкою золотою смужкою; наведення чи фокус — пауза; шеврон розгортає список у дві колонки. Клік на тост —
 *   чат «Світ».
 * «Зменшити рух»: без автозміни (телефон — тост змінюється після дотику, десктоп — лише стрілки), без смужки. Поки
 * список розгорнуто — ротація стоїть. Нічого не лягає на плеєр: смуга — у потоці під ним.
 * Смуга є лише поки свято йде (рішення власника 2026-11-13, `useCanToast`): до й після свята її немає зовсім.
 * Телефон: обгортка позначена `data-dock-above` — розгорнутий чат починається під смугою (дошка «Чат розгорнуто»);
 * розгорнули чат — список смуги згортається, щоб чат не опускався.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState } from 'react';
import { useChatDockControls } from '@/components/chat/ChatDock';
import { cn } from '@/components/primitives/cn';
import { EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { Reveal } from '@/components/primitives/Reveal';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { Ms } from '@/lib/data/types';
import { formatClock, formatDurationShort } from '@/lib/i18n/time';
import { keepIndex, LATEST_IN_LIST, stepIndex, type StripItem, type StripView } from '@/lib/toast/feed';
import { useChatUi } from '@/stores/chat';
import { useChatDock } from '@/stores/chatDock';
import { useGuestStore } from '@/stores/guest';
import { ToastBubble } from './ToastBubble';
import { useOpenToastWindow } from './ToastWindow';
import { useCanToast } from './useToastSeason';
import { useWorldToasts } from './useWorldToasts';
import t2 from './toast.module.css';
import s from './toastStrip.module.css';

/** «щойно» / «3 хв» — скільки минуло. */
export function useAgo() {
  const t = useTranslations('toast.strip');
  return (now: Ms, at: Ms) => (now - at < 60_000 ? t('justNow') : formatDurationShort(Math.floor((now - at) / 60_000) * 60_000));
}

/** Кнопка «Сказати тост» / «Тост» — нейтральна, з золотим келихом. */
function ToastButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('t2f-focus t2f-press', t2.toastBtn, className)} data-action="toast-open">
      <Icon name="glass" size={16} />
      {label}
    </button>
  );
}

/** «Усі тости в чаті «Світ»» і клік на тост: чат «Світ» — розгорнутий (телефон) чи показаний у колонці (десктоп). */
function useOpenWorldChat() {
  const overlay = useOverlay();
  const column = useChatColumn();
  const { expand } = useChatDockControls();
  return () => {
    useChatUi.getState().requestWorld();
    overlay.close();
    if (column) {
      useGuestStore.getState().setChatHidden(false);
      useChatUi.getState().markHidden(null);
      document.getElementById('chat')?.scrollIntoView({ block: 'nearest' });
    } else {
      expand();
    }
  };
}

/** Ротація по одному: індекс тримає той самий тост, коли список змінюється; крок — ‹ › чи кінець смужки-годинника. */
function useRotation(view: StripView) {
  const [state, setState] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const rotation = view.rotation;
  const index = keepIndex(rotation, state.id, state.index);
  const item = rotation[index] ?? null;
  const step = (dir: 1 | -1) => {
    const next = stepIndex(index, rotation.length, dir);
    setState({ id: rotation[next]?.toast.id ?? null, index: next });
  };
  return { item, index, total: rotation.length, step };
}

function Lists({ view, now, variant }: { view: StripView; now: Ms; variant: 'phone' | 'desk' }) {
  const t = useTranslations('toast.strip');
  const ago = useAgo();
  const pinned = (
    <div>
      <p className={s.label}>{t('pinnedTitle')}</p>
      <ul className={s.list} data-toast-list="pinned">
        {view.pinned.map(({ toast, until }) => (
          <li key={toast.id}>
            <ToastBubble nick={toast.nick} flagCode={toast.flagCode} text={toast.text} tier={toast.tier} aside={until ? t('pinnedShort', { time: formatClock(until) }) : undefined} />
          </li>
        ))}
      </ul>
    </div>
  );
  const latest = (
    <div>
      <p className={s.label}>{t('latestTitle')}</p>
      <ul className={s.list} data-toast-list="latest">
        {view.latest.slice(0, LATEST_IN_LIST).map(({ toast }) => (
          <li key={toast.id}>
            <ToastBubble nick={toast.nick} flagCode={toast.flagCode} text={toast.text} tier="plain" aside={ago(now, toast.createdAt)} />
          </li>
        ))}
      </ul>
    </div>
  );
  return variant === 'desk' ? (
    // Одна з колонок порожня — друга на всю ширину.
    <div className={s.grid} data-single={!view.pinned.length || !view.latest.length || undefined}>
      {view.pinned.length ? pinned : null}
      {view.latest.length ? latest : null}
    </div>
  ) : (
    <>
      {view.pinned.length ? pinned : null}
      {view.latest.length ? latest : null}
    </>
  );
}

/** Годинник ротації: смужка (десктоп — видима) скінчилась — наступний тост. */
function Progress({ itemKey, onDone, visible }: { itemKey: string; onDone: () => void; visible: boolean }) {
  return (
    <>
      {visible ? <span aria-hidden="true" className={s.track} /> : null}
      <span key={itemKey} aria-hidden="true" className={s.progress} data-hidden={visible ? undefined : ''} onAnimationEnd={onDone} data-toast-progress="" />
    </>
  );
}

export interface ToastStripProps {
  variant: 'phone' | 'desk';
  className?: string;
  /** Телефон: без відступів слота під рядком часу (кімната ставить свої). */
  bare?: boolean;
}

export function ToastStrip({ variant, className, bare }: ToastStripProps) {
  const { ready, view, now } = useWorldToasts();
  const canToast = useCanToast();
  if (!ready || !canToast) return null;
  return variant === 'desk' ? <DeskStrip view={view} now={now} className={className} /> : <PhoneStrip view={view} now={now} className={className} bare={bare} />;
}

function DeskStrip({ view, now, className }: { view: StripView; now: Ms; className?: string }) {
  const t = useTranslations('toast');
  const ts = useTranslations('toast.strip');
  const openToast = useOpenToastWindow();
  const openWorld = useOpenWorldChat();
  const reduce = useReducedMotion();
  const ago = useAgo();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const rot = useRotation(view);
  const listId = useId();
  const titleId = useId();

  if (!view.total) {
    return (
      // Ціла картка — кнопка (дошка «Зблизька · порожньо»): дотик будь-де відкриває вікно; доступна кнопка — «Сказати тост».
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
      <section aria-label={ts('label')} className={cn(s.card, s.deskEmpty, className)} onClick={() => openToast()} data-toast-strip="empty">
        <span className={s.emptyIcon} aria-hidden="true">
          <Icon name="glass" size={20} />
        </span>
        <div className={s.emptyBody}>
          <p className={s.emptyTitle}>{ts('emptyTitle')}</p>
          <p className={s.emptyText}>{ts('emptyText')}</p>
        </div>
        <ToastButton label={t('action')} onClick={() => openToast()} />
      </section>
    );
  }

  const paused = open || hover || focus;
  const item = rot.item;
  return (
    <section
      aria-labelledby={titleId}
      className={cn(s.card, s.desk, className)}
      data-toast-strip={open ? 'open' : 'one'}
      data-paused={paused || undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <div className={s.head}>
        <span className={t2.gold} aria-hidden="true">
          <Icon name="glass" size={18} />
        </span>
        <h2 id={titleId} className={s.title}>
          {ts('label')}
        </h2>
        <span className={s.metaText}>{ts('meta', { count: view.total, countries: view.countries })}</span>
        <span className={s.spacer} />
        {open ? null : (
          <>
            <span className={s.nav}>
              <button type="button" className={cn('t2f-focus', s.round)} aria-label={ts('prev')} onClick={() => rot.step(-1)} data-action="toast-prev">
                <Icon name="chevron-left" size={16} />
              </button>
              <span className={s.pos} data-toast-pos="">
                <span aria-hidden="true">
                  {rot.index + 1} / {rot.total}
                </span>
                <span className="sr-only">{ts('position', { index: rot.index + 1, total: rot.total })}</span>
              </span>
              <button type="button" className={cn('t2f-focus', s.round)} aria-label={ts('next')} onClick={() => rot.step(1)} data-action="toast-next">
                <Icon name="chevron-right" size={16} />
              </button>
            </span>
            <span className={s.divider} aria-hidden="true" />
          </>
        )}
        <button
          type="button"
          className={cn('t2f-focus', s.round)}
          data-size="36"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={open ? ts('collapse') : ts('expand')}
          onClick={() => setOpen((v) => !v)}
          data-action="toast-expand"
        >
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
        <ToastButton label={t('action')} onClick={() => openToast()} />
      </div>
      {!open && item ? (
        <button type="button" key={item.toast.id} className={cn('t2f-focus', s.deskCard, s.fade)} data-pinned={item.until ? '' : undefined} onClick={openWorld} data-toast-id={item.toast.id}>
          <span className={s.deskFlag}>
            <Flag round code={item.toast.flagCode} diameter={30} decorative />
          </span>
          <span className={s.deskBody}>
            <span className={s.deskWho}>
              <b className={s.deskNick}>{item.toast.nick}</b>
              <Aside item={item} now={now} ago={ago} />
            </span>
            <span className={cn(s.deskText, 'block')}>
              <EmojiText text={item.toast.text} />
            </span>
          </span>
        </button>
      ) : null}
      <Reveal open={open} id={listId}>
        <Lists view={view} now={now} variant="desk" />
        <button type="button" className={cn('t2f-focus', s.allLink)} onClick={openWorld} data-action="toast-all">
          {ts('allInChat')}
        </button>
      </Reveal>
      {!open && item && !reduce && rot.total > 1 ? <Progress itemKey={`${item.toast.id}:${rot.index}`} onDone={() => rot.step(1)} visible /> : null}
    </section>
  );
}

function Aside({ item, now, ago }: { item: StripItem; now: Ms; ago: (now: Ms, at: Ms) => string }) {
  const ts = useTranslations('toast.strip');
  if (item.until) {
    return (
      <span className={s.pinMeta}>
        <Icon name="pin" size={14} />
        {ts('pinnedUntil', { time: formatClock(item.until) })}
      </span>
    );
  }
  const text = ago(now, item.toast.createdAt);
  return (
    <span className={s.ago} data-fresh={now - item.toast.createdAt < 60_000 ? '' : undefined}>
      {text}
    </span>
  );
}

function PhoneStrip({ view, now, className, bare }: { view: StripView; now: Ms; className?: string; bare?: boolean }) {
  const t = useTranslations('toast');
  const ts = useTranslations('toast.strip');
  const openToast = useOpenToastWindow();
  const openWorld = useOpenWorldChat();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const rot = useRotation(view);
  const listId = useId();
  // Розгорнули чат — список згортається: чат починається під смугою (`data-dock-above`) і не має опускатися.
  const chatOpen = useChatDock((d) => d.expanded);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- чат розгорнуто: список смуги згортається
    if (chatOpen) setOpen(false);
  }, [chatOpen]);
  const toggle = () => {
    // «Зменшити рух»: тост змінюється не сам, а після дотику — коли список згортають.
    if (open && reduce) rot.step(1);
    setOpen((v) => !v);
  };

  if (!view.total) {
    return (
      <div data-dock-above="" className={cn(!bare && s.slot, className)}>
        <button type="button" onClick={() => openToast()} className={cn('t2f-focus', s.card, s.phoneEmpty)} data-toast-strip="empty">
          <span className={s.emptyIcon} aria-hidden="true">
            <Icon name="glass" size={16} />
          </span>
          <span className={s.phoneEmptyTitle}>{ts('emptyTitle')}</span>
          <span className={s.lineIcon} aria-hidden="true">
            <Icon name="chevron-right" size={16} />
          </span>
        </button>
      </div>
    );
  }

  const item = rot.item;
  return (
    <div data-dock-above="" className={cn(!bare && s.slot, className)}>
      <section aria-label={ts('label')} className={cn(s.card, open && s.phoneOpen)} data-toast-strip={open ? 'open' : 'line'} data-paused={open || undefined}>
        {open ? (
          <div className={s.head}>
            <span className={t2.gold} aria-hidden="true">
              <Icon name="glass" size={16} />
            </span>
            <h2 className={s.title}>{ts('label')}</h2>
            <span className={s.metaText}>{ts('metaShort', { count: view.total, countries: view.countries })}</span>
            <span className={s.spacer} />
            <button type="button" className={cn('t2f-focus', s.up)} aria-expanded aria-controls={listId} aria-label={ts('collapse')} onClick={toggle} data-action="toast-expand">
              <Icon name="chevron-up" size={18} />
            </button>
          </div>
        ) : item ? (
          <div className={s.phone}>
            <button
              type="button"
              key={item.toast.id}
              className={cn('t2f-focus', s.line, s.fade)}
              data-pinned={item.until ? '' : undefined}
              aria-expanded={false}
              aria-controls={listId}
              aria-label={ts('lineLabel', { nick: item.toast.nick, text: item.toast.text })}
              onClick={toggle}
              data-toast-id={item.toast.id}
              data-action="toast-expand"
            >
              <Flag round code={item.toast.flagCode} diameter={22} decorative />
              <b className={s.lineNick}>{item.toast.nick}</b>
              <span className={s.lineText}>
                <EmojiText text={item.toast.text} />
              </span>
              {item.until ? (
                <span className={s.lineIcon} data-gold="" aria-hidden="true">
                  <Icon name="pin" size={14} />
                </span>
              ) : null}
              <span className={s.lineIcon} aria-hidden="true">
                <Icon name="chevron-down" size={14} />
              </span>
            </button>
            <ToastButton label={t('short')} onClick={() => openToast()} className={s.phoneBtn} />
          </div>
        ) : null}
        <Reveal open={open} id={listId}>
          <Lists view={view} now={now} variant="phone" />
          <ToastButton label={t('action')} onClick={() => openToast()} className={s.fullBtn} />
          <button type="button" className={cn('t2f-focus', s.allLink)} onClick={openWorld} data-action="toast-all">
            {ts('allInChat')}
          </button>
        </Reveal>
        {!open && item && !reduce && rot.total > 1 ? <Progress itemKey={`${item.toast.id}:${rot.index}`} onDone={() => rot.step(1)} visible={false} /> : null}
      </section>
    </div>
  );
}
