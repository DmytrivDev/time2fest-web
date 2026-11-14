'use client';

/**
 * Розкладка закріпленого вікна чату (`ChatDock`): атрибути на `<html>`, відступи сторінки, вимірювання верху вікна під
 * рядком часу, телефон-альбом (чат у потоці, клавіатура) і «тонка» згорнута плашка. Порядок ефектів збережено як у компоненті.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { measureSheetTop, SHEET_TOP_SOURCES, stableViewportH } from '@/lib/overlay/sheetTop';
import { findAnchor, type DockViewport } from './chatDockGeometry';

export function useChatDockLayout(o: {
  open: boolean;
  layerOpen: boolean;
  land: boolean;
  landFlow: boolean;
  kbOpen: boolean;
  vv: DockViewport;
  sectionRef: RefObject<HTMLElement | null>;
  reduceMotion: boolean;
}) {
  const { open, layerOpen, land, landFlow, kbOpen, vv, sectionRef, reduceMotion } = o;
  const [top, setTop] = useState(0);
  const [videoTop, setVideoTop] = useState(0);
  const [past, setPast] = useState(false);
  const landHidden = land && !open && !past;

  // Нижній відступ сторінки на висоту згорнутого вікна (globals.css); у альбомі — лише коли вікно видно внизу.
  const reserve = !(land && (landHidden || open));
  useEffect(() => {
    if (!reserve) return;
    document.documentElement.setAttribute('data-has-chat-dock', '');
    return () => document.documentElement.removeAttribute('data-has-chat-dock');
  }, [reserve]);

  // Згорнутий: гортаємо вгору — від плашки лишається тонка смужка з ручкою (дотик розгортає); униз чи в самому низу
  // сторінки — знову вся плашка (рішення 2026-10-28).
  const [slim, setSlim] = useState(false);
  useEffect(() => {
    // Лише портрет: в альбомі згорнутий чат завжди повний (з'являється нижче рядка часу).
    if (open || land) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (atBottom || y <= 0) setSlim(false);
      else if (y < lastY - 6) setSlim(true);
      else if (y > lastY + 6) setSlim(false);
      if (Math.abs(y - lastY) > 6) lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      setSlim(false); // після розгортання згорнутий чат знову повний
    };
  }, [open, land]);

  // Телефон-альбом, згорнутий: чи прокручено нижче смуги (низ останнього елемента над чатом вище верху вікна).
  useEffect(() => {
    if (!land || open) return;
    const main = sectionRef.current?.parentElement ?? null;
    const update = () => {
      const a = findAnchor(main);
      setPast(a ? a.getBoundingClientRect().bottom <= 4 : false);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (main) ro?.observe(main);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [land, open, sectionRef]);

  // Розгорнутий чат: плашка cookies тимчасово ховається (inline-стиль не потрібен — правило в primitives.css).
  useEffect(() => {
    if (!open && !layerOpen) return;
    document.documentElement.setAttribute('data-chat-dock-expanded', '');
    return () => document.documentElement.removeAttribute('data-chat-dock-expanded');
  }, [open, layerOpen]);

  // Телефон-альбом, розгорнутий: чат — блок у потоці одразу після смуги (висота вікна), сторінка прокручується як завжди;
  // при розгортанні прокручуємо так, щоб чат заповнив екран.
  useLayoutEffect(() => {
    if (!landFlow) return;
    const el = sectionRef.current;
    const anchor = findAnchor(el?.parentElement ?? null);
    const html = document.documentElement;
    html.setAttribute('data-chat-land-expanded', '');
    anchor?.setAttribute('data-dock-anchor', '');
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: y, behavior: reduceMotion ? 'instant' : 'smooth' });
    }
    return () => {
      html.removeAttribute('data-chat-land-expanded');
      anchor?.removeAttribute('data-dock-anchor');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landFlow]);

  // Розгорнутий: вікно починається під рядком часу (`measureSheetTop('chat')`); сторінка нагорі й не прокручується.
  useLayoutEffect(() => {
    if ((!open && !layerOpen) || land) return;
    // Сторінка не блокується й нічого не липне: чат фіксований унизу, його висота — місце під смугою при scrollTop = 0
    // (міряємо при розгортанні й зміні розміру, за прокруткою не слідуємо).
    const measure = () => {
      setTop(measureSheetTop('chat'));
      setVideoTop(measureSheetTop('video'));
    };
    measure();
    const frame = requestAnimationFrame(measure);
    // Лише зміна ширини (поворот, інше вікно): зміна самої висоти — це адресна стрічка, на неї висота чату не реагує.
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      measure();
    };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    document.querySelectorAll(SHEET_TOP_SOURCES).forEach((el) => ro?.observe(el));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [open, layerOpen, land]);

  // Розгорнутий (портрет): запас унизу сторінки = висота чату, щоб усе можна було прокрутити над ним. Після згортання
  // запас лишається, доки вікно не доїде вниз (без стрибка під час анімації), потім знімається.
  const padH = open && !land ? Math.max(0, stableViewportH() - top) : null;
  useEffect(() => {
    if (padH === null) return;
    const html = document.documentElement;
    html.setAttribute('data-chat-dock-pad', '');
    html.style.setProperty('--chat-dock-pad', `${padH}px`);
  }, [padH]);
  useEffect(() => {
    if (open) return;
    const html = document.documentElement;
    if (!html.hasAttribute('data-chat-dock-pad')) return;
    const clear = () => {
      html.removeAttribute('data-chat-dock-pad');
      html.style.removeProperty('--chat-dock-pad');
    };
    if (reduceMotion || land) {
      clear();
      return;
    }
    const id = window.setTimeout(clear, 260);
    return () => window.clearTimeout(id);
  }, [open, reduceMotion, land]);
  useEffect(
    () => () => {
      document.documentElement.removeAttribute('data-chat-dock-pad');
      document.documentElement.style.removeProperty('--chat-dock-pad');
    },
    [],
  );

  // Альбом + клавіатура: запас унизу сторінки (щоб чат можна було вирівняти по верху видимої області) і вирівнювання.
  const landKb = landFlow && kbOpen;
  useLayoutEffect(() => {
    if (!landKb) return;
    const html = document.documentElement;
    html.style.setProperty('--kb-pad', `${Math.max(0, vv.inner - vv.h)}px`);
    const el = sectionRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - vv.off, behavior: 'instant' });
    return () => {
      html.style.removeProperty('--kb-pad');
    };
  }, [landKb, vv.h, vv.off, vv.inner, sectionRef]);
  // Клавіатуру закрито — чат знову на весь екран (без стрибка: те саме місце сторінки).
  const wasLandKb = useRef(false);
  useLayoutEffect(() => {
    if (wasLandKb.current && !landKb && landFlow) {
      const el = sectionRef.current;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    }
    wasLandKb.current = landKb;
  }, [landKb, landFlow, sectionRef]);

  // Альбом, розгорнутий: верх відео — на верх вікна (не шапка сайту); плавно, за «зменшити рух» — миттєво.
  const toVideo = useCallback(() => {
    const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
    if (!slot) return;
    const y = slot.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'instant' : 'smooth' });
  }, [reduceMotion]);
  const ctx = useMemo(() => ({ toVideo: landFlow ? toVideo : null }), [landFlow, toVideo]);

  return { top, setTop, videoTop, slim, landHidden, ctx };
}
