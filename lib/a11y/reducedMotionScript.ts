/**
 * Константи «зменшити рух» і вбудований скрипт для `<head>` (без 'use client', щоб серверний
 * кореневий layout отримав рядок, а не клієнтське посилання).
 */
import { GUEST_STORAGE_KEY } from '@/stores/guest';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const REDUCE_MOTION_ATTR = 'data-reduce-motion';

/**
 * Виставляє `<html data-reduce-motion="true|false">` до гідратації (без миготіння анімацій):
 * системне `prefers-reduced-motion` АБО збережений перемикач сайту. Читання — у `try/catch`.
 */
export const REDUCED_MOTION_INIT_SCRIPT = `(function(){var r=false;try{r=window.matchMedia(${JSON.stringify(
  REDUCED_MOTION_QUERY,
)}).matches}catch(e){}try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  GUEST_STORAGE_KEY,
)})||'null');if(s&&s.state&&s.state.reducedMotion===true)r=true}catch(e){}document.documentElement.setAttribute(${JSON.stringify(
  REDUCE_MOTION_ATTR,
)},r?'true':'false')})();`;
