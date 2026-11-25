/**
 * Поштовий сервіс (ring 3, SPEC-10 [П-7], W20; AC-36 … AC-44, AC-48): один `send` над основним і запасним
 * транспортом. «Жоден код не губиться»: відмова основного з причиною не в адресі → той самий лист (той самий
 * `Message-ID` / `Resend-Idempotency-Key`) рівно один раз через запасного.
 *
 * - Допуск за добовими стелями (`domain/mail/ceiling.ts`): ≥80 % основного відмовляє класу `other`; коди — до
 *   100 % основного, далі запасний до його стелі; обидві вичерпано → `unavailable` (AC-44).
 * - Запобіжник (`mail:broken:<provider>`, значення — мс епохи кінця): квота — до 00:00 UTC, інше — 5 хв; поки
 *   основний зламаний, листи йдуть одразу в запасний (AC-39). Порівнюється з годинником сервісу (тестовий годинник
 *   працює), TTL ключа — лише прибирання.
 * - Лічильники доби UTC `mail:sent:<provider>:<yyyymmdd>` після кожного успіху; тривоги `page` (один раз за період,
 *   захоплення `setIfAbsent`): `mail/provider-failover` (на період «зламаний», AC-41), `mail/all-providers-down`
 *   (раз на 5 хв, AC-40), `mail/daily-70` (основний, раз на добу, AC-42), `mail/ceiling-80` (на постачальника,
 *   раз на добу, деталь лише `provider`, AC-43).
 * - Redis недоступний: лист однаково йде (лічильник 0, запобіжник «не зламаний»); тривогу краще підняти двічі,
 *   ніж пропустити. Ніколи не кидає; адреса й текст відповіді не логуються.
 */
import { brokenUntil } from '../domain/mail/breaker';
import { admit } from '../domain/mail/ceiling';
import { classifyMailError } from '../domain/mail/classify';
import { msToUtcMidnight, utcDayKey } from '../domain/mail/day';
import type { Alarm, Clock, FastStore, Logger } from '../ports';
import type { MailMessage, MailSendResult, MailService, MailTransport } from './ports';

export const MAIL_PRIMARY = 'primary';
export const MAIL_FALLBACK = 'fallback';
export type MailProvider = typeof MAIL_PRIMARY | typeof MAIL_FALLBACK;

/** AC-42: тривога, коли основний за добу UTC досяг стількох листів. */
export const MAIL_DAILY_ALARM_AT = 70;
export const ALL_DOWN_ALARM_MS = 5 * 60 * 1000;

export const mailSentKey = (provider: MailProvider, day: string): string => `mail:sent:${provider}:${day}`;
export const mailBrokenKey = (provider: MailProvider): string => `mail:broken:${provider}`;

export interface MailServiceOptions {
  primary: MailTransport;
  /** Відсутній → відмова основного (не адреси) = `unavailable`. */
  fallback?: MailTransport;
  store: FastStore;
  alarm: Alarm;
  /** Настінний годинник (не сезонний). */
  clock: Clock;
  ceilings: { primary: number; fallback: number };
  log?: Logger;
}

export function createMailService(o: MailServiceOptions): MailService {
  const { store, alarm } = o;
  const warn = (what: string, err: unknown) =>
    o.log?.warn({ event: 'mail-store-failed', what, error: err instanceof Error ? err.name : 'unknown' });

  async function count(provider: MailProvider, day: string): Promise<number> {
    try {
      const v = Number(await store.get(mailSentKey(provider, day)));
      return Number.isFinite(v) ? v : 0;
    } catch (e) {
      warn('count', e);
      return 0;
    }
  }

  async function isBroken(provider: MailProvider, nowMs: number): Promise<boolean> {
    try {
      const until = Number(await store.get(mailBrokenKey(provider)));
      return Number.isFinite(until) && until > nowMs;
    } catch (e) {
      warn('broken-read', e);
      return false;
    }
  }

  /** Позначає зламаним; true — коли це новий період (тоді й тривога). */
  async function markBroken(provider: MailProvider, kind: 'quota' | 'other', now: Date): Promise<boolean> {
    const until = brokenUntil(kind, now);
    const key = mailBrokenKey(provider);
    const ttl = Math.max(1000, until - now.getTime());
    try {
      if (await store.setIfAbsent(key, String(until), ttl)) return true;
      const current = Number(await store.get(key));
      const live = Number.isFinite(current) && current > now.getTime();
      if (!live || until > current) await store.set(key, String(until), ttl);
      return !live;
    } catch (e) {
      warn('broken-write', e);
      return true;
    }
  }

  /** Захоплення «один раз за період»; без сховища — true (краще двічі, ніж жодного). */
  async function claim(key: string, ttlMs: number): Promise<boolean> {
    try {
      return await store.setIfAbsent(key, '1', Math.max(1000, ttlMs));
    } catch (e) {
      warn('claim', e);
      return true;
    }
  }

  async function allDown(): Promise<MailSendResult> {
    if (await claim('mail:alarm:all-providers-down', ALL_DOWN_ALARM_MS)) {
      alarm.raise({ level: 'page', source: 'mail', code: 'mail/all-providers-down' });
    }
    return { ok: false, reason: 'unavailable' };
  }

  async function counted(provider: MailProvider, now: Date, day: string): Promise<MailSendResult> {
    const toMidnight = msToUtcMidnight(now);
    let after: number;
    try {
      after = (await store.incrWindow(mailSentKey(provider, day), toMidnight)).count;
    } catch (e) {
      warn('count-write', e);
      return { ok: true, provider };
    }
    const ceiling = provider === MAIL_PRIMARY ? o.ceilings.primary : o.ceilings.fallback;
    if (provider === MAIL_PRIMARY && after >= MAIL_DAILY_ALARM_AT && (await claim(`mail:alarm:daily-70:${provider}:${day}`, toMidnight))) {
      alarm.raise({ level: 'page', source: 'mail', code: 'mail/daily-70' });
    }
    if (after >= ceiling * 0.8 && (await claim(`mail:alarm:ceiling-80:${provider}:${day}`, toMidnight))) {
      alarm.raise({ level: 'page', source: 'mail', code: 'mail/ceiling-80', details: { provider } });
    }
    return { ok: true, provider };
  }

  async function viaFallback(msg: MailMessage, now: Date, day: string, fallbackRoom: boolean): Promise<MailSendResult> {
    if (!o.fallback || !fallbackRoom) return allDown();
    const res = await o.fallback.send(msg);
    if (res.ok) return counted(MAIL_FALLBACK, now, day);
    if (classifyMailError(res.err).kind === 'recipient') return { ok: false, reason: 'recipient' };
    return allDown();
  }

  return {
    async countsToday() {
      const day = utcDayKey(new Date(o.clock.now()));
      const [primary, fallback] = await Promise.all([count(MAIL_PRIMARY, day), count(MAIL_FALLBACK, day)]);
      return { primary: { sent: primary, ceiling: o.ceilings.primary }, fallback: { sent: fallback, ceiling: o.ceilings.fallback } };
    },
    async send(msg) {
      const now = new Date(o.clock.now());
      const day = utcDayKey(now);
      const [primaryCount, fallbackCount] = await Promise.all([count(MAIL_PRIMARY, day), count(MAIL_FALLBACK, day)]);
      const admission = admit({
        class: msg.class,
        primaryCount,
        primaryCeiling: o.ceilings.primary,
        fallbackCount,
        fallbackCeiling: o.ceilings.fallback,
      });
      if (admission === 'refuse') return { ok: false, reason: 'unavailable' };
      const fallbackRoom = fallbackCount < o.ceilings.fallback;
      if (admission === 'fallback' || (await isBroken(MAIL_PRIMARY, now.getTime()))) {
        return viaFallback(msg, now, day, fallbackRoom);
      }
      const res = await o.primary.send(msg);
      if (res.ok) return counted(MAIL_PRIMARY, now, day);
      const failure = classifyMailError(res.err);
      if (failure.kind === 'recipient') return { ok: false, reason: 'recipient' };
      if (await markBroken(MAIL_PRIMARY, failure.broken, now)) {
        alarm.raise({ level: 'page', source: 'mail', code: 'mail/provider-failover', details: { provider: MAIL_PRIMARY } });
      }
      return viaFallback(msg, now, day, fallbackRoom);
    },
  };
}
