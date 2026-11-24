/**
 * Тексти повідомлень у Telegram (SPEC-13b AC-10, AC-7, AC-18, AC-20), ring 1 — чисті функції; час — параметр.
 *
 * Звичайний текст українською без розмітки (адаптер шле без `parse_mode`), ≤1 000 символів. Назва домену,
 * значення й дія — з реєстру (`registries/ops.ts`), деталі — вже очищені `sanitizeDetails` (AC-11).
 * Обрізається лише змінна частина (деталі, перелік доменів), сталі рядки й підказка лишаються.
 */
import type { AlarmDetails } from '../../alarms/ports';
import type { EnvClass } from '../../platform/env';
import type { OpsAlarmRow, OpsDomainRow } from '../../registries/ops';

/** Найдовше повідомлення (AC-10). */
export const ALARM_TEXT_MAX_CHARS = 1_000;
export const UNKNOWN_DOMAIN_TITLE = 'невідомо';
const CONFIRM_HINT = 'Підтвердити: адмінка → Моніторинг';
const ELLIPSIS = '…';

const CLASS_TITLE: Readonly<Record<EnvClass, string>> = {
  test: 'тест (test)',
  rehearsal: 'репетиція (rehearsal)',
  production: 'робоче (production)',
};

const kyivParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Kyiv',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `дд.мм.рррр гг:хх:сс` за Києвом. */
export function formatKyiv(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of kyivParts.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = part.value;
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** `дд.мм.рррр гг:хх:сс` за UTC. */
export function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function timeLine(ms: number): string {
  return `Час: ${formatKyiv(ms)} за Києвом · ${formatUtc(ms)} UTC`;
}

/** «1 раз», «2 рази», «5 разів», «21 раз». */
export function timesWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} раз`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} рази`;
  return `${n} разів`;
}

/** Вік як «2 год 5 хв» / «40 хв» / «менше хвилини»; `null` — копій ще немає. */
export function formatAge(ms: number | null): string {
  if (ms === null) return 'копій ще немає';
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'менше хвилини';
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} д`);
  if (hours > 0) parts.push(`${hours} год`);
  if (mins > 0 && days === 0) parts.push(`${mins} хв`);
  return parts.join(' ');
}

/** Рядок про останню копію бази. */
function backupLine(ageMs: number | null): string {
  return ageMs === null ? 'Остання копія бази: копій ще немає' : `Остання копія бази: ${formatAge(ageMs)} тому`;
}

/** Не розрізати сурогатну пару на межі. */
function sliceSafe(text: string, end: number): string {
  if (end <= 0) return '';
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? text.slice(0, end - 1) : text.slice(0, end);
}

/**
 * Збирає текст: `head` і `tail` — сталі, `body` — змінна частина, обрізана так, щоб усе вмістилося
 * в `ALARM_TEXT_MAX_CHARS` (з «…» на місці відрізаного).
 */
function assemble(head: readonly string[], body: readonly string[], tail: readonly string[]): string {
  const fixed = [...head, ...tail].join('\n');
  const full = [...head, ...body, ...tail].join('\n');
  if (full.length <= ALARM_TEXT_MAX_CHARS) return full;
  const room = ALARM_TEXT_MAX_CHARS - fixed.length - 2 - ELLIPSIS.length;
  if (room <= 0) return sliceSafe(full, ALARM_TEXT_MAX_CHARS - ELLIPSIS.length) + ELLIPSIS;
  const cutBody = sliceSafe(body.join('\n'), room) + ELLIPSIS;
  return [...head, cutBody, ...tail].join('\n');
}

export interface AlarmTextInput {
  /** Рядок реєстру (`findKind`); `undefined` — незареєстрований вид (AC-27). */
  row: { domain: Pick<OpsDomainRow, 'title'>; alarm: Pick<OpsAlarmRow, 'meaning' | 'action'> } | undefined;
  /** `source` / `code` як піднято — коди з коду, у текст ідуть лише для незареєстрованого виду. */
  kind: { source: string; code: string };
  cls: EnvClass;
  /** Уже очищені деталі (`sanitizeDetails`). */
  details?: AlarmDetails;
  raisedAt: number;
  /** Повтори попереднього повідомлення цього виду (AC-6); 0 — рядка немає. */
  repeatCount?: number;
}

const KIND_CODE = /^[A-Za-z0-9_.:\-/]{1,64}$/;

/** Текст повідомлення тривоги (AC-10). */
export function buildAlarmText(input: AlarmTextInput): string {
  const { row, kind, cls, details, raisedAt } = input;
  const repeats = Math.max(0, Math.floor(input.repeatCount ?? 0));
  const kindName = `${kind.source}/${kind.code}`;
  const safeKind = KIND_CODE.test(kindName) ? kindName : 'код не показано';
  const head = [
    `ТРИВОГА · середовище: ${CLASS_TITLE[cls]}`,
    `Домен: ${row ? row.domain.title : UNKNOWN_DOMAIN_TITLE}`,
    row ? `Що сталося: ${row.alarm.meaning}` : `Що сталося: незареєстрований вид тривоги ${safeKind}.`,
    row ? `Що робити: ${row.alarm.action}` : 'Що робити: додати вид у реєстр тривог і метрик; подивитися журнал сервера біля часу тривоги.',
    timeLine(raisedAt),
  ];
  const tail = [
    ...(repeats > 0 ? [`Після попереднього повідомлення повторилось ${timesWord(repeats)}.`] : []),
    CONFIRM_HINT,
  ];
  const entries = details ? Object.entries(details) : [];
  const body = entries.length > 0 ? ['Деталі:', ...entries.map(([k, v]) => `${k}: ${v}`)] : [];
  return assemble(head, body, tail);
}

/** Підсумок шторму (AC-7): «ще N тривог, див. Моніторинг» з переліком доменів. */
export function buildStormSummary(input: { cls: EnvClass; held: number; domains: readonly string[]; at: number }): string {
  const unique = [...new Set(input.domains)].sort((a, b) => a.localeCompare(b, 'uk'));
  const head = [
    `ТРИВОГА · середовище: ${CLASS_TITLE[input.cls]}`,
    `Забагато тривог: ще ${input.held} без окремих повідомлень, див. Моніторинг.`,
    timeLine(input.at),
  ];
  const body = unique.length > 0 ? [`Домени: ${unique.join(', ')}`] : [];
  return assemble(head, body, [CONFIRM_HINT]);
}

export type DeliveryState = 'ok' | 'retrying' | 'failed-recently';

const DELIVERY_TITLE: Readonly<Record<DeliveryState, string>> = {
  ok: 'усе доставлено',
  retrying: 'є повідомлення в повторах',
  'failed-recently': 'за останню добу є недоставлені',
};

/** Щогодинне контрольне повідомлення (AC-18). */
export function buildHeartbeatText(input: {
  cls: EnvClass;
  openPage: number;
  lastBackupAgeMs: number | null;
  delivery: DeliveryState;
  at: number;
}): string {
  const first = input.openPage === 0 ? 'Усе гаразд' : `Зв'язок працює; відкритих тривог: ${input.openPage}`;
  return assemble(
    [
      `${first} · середовище: ${CLASS_TITLE[input.cls]}`,
      `Відкритих тривог: ${input.openPage}`,
      backupLine(input.lastBackupAgeMs),
      `Доставка: ${DELIVERY_TITLE[input.delivery]}`,
      timeLine(input.at),
    ],
    [],
    [],
  );
}

export interface DigestLogKind {
  /** Назва домену з реєстру або «невідомо». */
  domain: string;
  /** `source/code`. */
  kind: string;
  count: number;
}

/** Ранковий підсумок (AC-20): `log`-тривоги за 24 год за доменами й до 10 найчастіших видів. */
export function buildDigestText(input: {
  cls: EnvClass;
  /** Дата за Києвом `рррр-мм-дд`. */
  date: string;
  logKinds: readonly DigestLogKind[];
  openPage: number;
  lastBackupAgeMs: number | null;
  /** Рядки витрат понад 50 %. */
  spendOver50: readonly { title: string; percent: number }[];
  at: number;
}): string {
  const byDomain = new Map<string, number>();
  let total = 0;
  for (const k of input.logKinds) {
    byDomain.set(k.domain, (byDomain.get(k.domain) ?? 0) + k.count);
    total += k.count;
  }
  const domains = [...byDomain.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk'));
  const top = [...input.logKinds].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)).slice(0, 10);
  const head = [
    `Ранковий підсумок ${input.date} · середовище: ${CLASS_TITLE[input.cls]}`,
    `Відкритих тривог: ${input.openPage}`,
    backupLine(input.lastBackupAgeMs),
    input.spendOver50.length > 0
      ? `Витрати понад 50 %: ${input.spendOver50.map((s) => `${s.title} ${Math.floor(s.percent)} %`).join(', ')}`
      : 'Витрати понад 50 %: немає',
    `Тривог рівня log за 24 год: ${total}`,
  ];
  const body = [
    ...domains.map(([d, n]) => `${d}: ${n}`),
    ...(top.length > 0 ? ['Найчастіші види:', ...top.map((k) => `${k.kind}: ${k.count}`)] : []),
  ];
  return assemble(head, body, []);
}
