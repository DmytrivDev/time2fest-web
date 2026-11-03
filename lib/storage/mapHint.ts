/**
 * Позначка «підказку жестів на мапі вже показано» (телефон, рішення власника 2026-11-03): cookie на рік. «Скинути стан
 * гостя» в машині часу її стирає — підказка покажеться знову. Будь-яка помилка доступу до cookie — як «уже показано».
 */
const COOKIE = 't2f_map_hint';

export function mapHintSeen(): boolean {
  try {
    return document.cookie.split('; ').some((c) => c === `${COOKIE}=1`);
  } catch {
    return true;
  }
}

export function markMapHintSeen(): void {
  try {
    document.cookie = `${COOKIE}=1; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    /* без cookie — покажемо й наступного разу */
  }
}

export function clearMapHintSeen(): void {
  try {
    document.cookie = `${COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch {
    /* немає cookie — нічого стирати */
  }
}
