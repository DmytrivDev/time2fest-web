import type { Ms } from '@/lib/data/types';

/** Найбільший зсув пояса на світі (+14 год, Кірібаті) з запасом: північ Нового року настає між 10:00 31.12 і 12:00 1.01 UTC. */
const LATEST_OFFSET_MS = 15 * 3_600_000;

/**
 * Рік, що настав опівночі пояса (рішення власника 2026-11-14: після півночі на місці великого таймера — «2027», а не
 * «00:00:00»). Північ події — місцева 00:00 1 січня, тож рік — місцева дата цієї миті: `midnightMs` + зсув пояса.
 * Без зсуву (місце не знає пояса) — та сама відповідь для будь-якої новорічної півночі: +15 год від неї — уже 1 січня
 * цього року за UTC для всіх поясів від −12 до +14.
 */
export function arrivedYear(midnightMs: Ms, offsetMinutes?: number): number {
  return new Date(midnightMs + (offsetMinutes !== undefined ? offsetMinutes * 60_000 : LATEST_OFFSET_MS)).getUTCFullYear();
}
