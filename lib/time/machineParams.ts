/**
 * Чисті помічники адреси й сховища для «машини часу» (`contracts/time-machine.md`) — без самої машини,
 * її ключа сховища й стартових констант: їх тримає `machineKit` (лише тестова збірка, SPEC-07 AC-58).
 * Не імпортує `machineLoader`/`params`: `machineKit` бере звідси, а цикл із верхньорівневим `await` завис би.
 */
import { sanitizeSpeed } from './speed';

export interface MachineParams {
  at?: number;
  speed?: number;
  panel: boolean;
  warnings: string[];
}

const OFFSET_RE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** Розбирає ISO 8601 лише з явним зсувом або `Z`. `+` у адресі може прийти пробілом. */
export function parseIsoWithOffset(raw: string): number | undefined {
  const s = raw.trim().replace(/ (\d{2}(?::?\d{2})?)$/, '+$1');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !OFFSET_RE.test(s)) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : ms;
}

export function parseMachineParams(search: string): MachineParams {
  const q = new URLSearchParams(search);
  const warnings: string[] = [];
  const out: MachineParams = { panel: q.get('panel') === '1', warnings };
  const t = q.get('t');
  if (t !== null) {
    const at = parseIsoWithOffset(t);
    if (at === undefined) warnings.push('Невірний t');
    else out.at = at;
  }
  const speed = q.get('speed');
  if (speed !== null) {
    const v = sanitizeSpeed(speed);
    if (v === 1 && Number(speed) !== 1) warnings.push('Невірний speed');
    out.speed = v;
  }
  return out;
}

/** Записує `t` і `speed` у адресу без перезавантаження (`history.replaceState`). */
export function writeMachineToUrl(state: { at: number; speed: number }, win: Window = window): void {
  try {
    const url = new URL(win.location.href);
    url.searchParams.set('t', new Date(Math.round(state.at)).toISOString().replace('.000Z', 'Z'));
    if (state.speed === 1) url.searchParams.delete('speed');
    else url.searchParams.set('speed', String(state.speed));
    win.history.replaceState(win.history.state, '', url.toString());
  } catch {
    // без адреси — не критично
  }
}

export function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}
