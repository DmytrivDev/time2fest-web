/**
 * Адреси сайту для QR-кодів і видимих коротких посилань (ТВ-режим, US7).
 *
 * TODO(власник): справжню коротку адресу ще не вирішено. Тут стоїть ПЛЕЙСХОЛДЕР `time2fest.com/s/…`:
 * код після `/s/` — тимчасовий, виведений із id події (однаковий для однієї події, без серверу).
 * Коли власник визначить схему, міняти лише цей файл — компоненти беруть адреси звідси.
 */

export const SITE_HOST = 'time2fest.com';

/** Коротка адреса для шерингу штампа: видима частина без протоколу. */
export const SHARE_SHORT_BASE = `${SITE_HOST}/s`;

/** Тимчасовий код з id події: 4 символи A–Z/0–9 (детермінований). */
export function placeholderShortCode(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/** Видима коротка адреса штампа події: `time2fest.com/s/K7Q2`. */
export function shareShortUrl(eventId: string): string {
  return `${SHARE_SHORT_BASE}/${placeholderShortCode(eventId)}`;
}

/** Адреса, яку кодує QR штампа (повна, з протоколом). */
export function shareUrl(eventId: string): string {
  return `https://${shareShortUrl(eventId)}`;
}

/** Сторінка Новорічного пасу (вхід — там само): QR «Мій графік» і першого заходу на ТВ. */
export const PASS_SHORT_URL = `${SITE_HOST}/pass`;
export const PASS_URL = `https://${PASS_SHORT_URL}/`;

/** «Рейтинг святкувань»: QR «Оціни з телефона» в режимі вечірки. */
export const RATING_SHORT_URL = `${SITE_HOST}/rating`;
export const RATING_URL = `https://${RATING_SHORT_URL}/`;

/** Режим вечірки: адреса для телевізора (інформаційна сторінка на телефоні). */
export const TV_SHORT_URL = `${SITE_HOST}/tv`;
export const TV_URL = `https://${TV_SHORT_URL}/`;
