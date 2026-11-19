/**
 * AI spend arithmetic (SPEC-09 AC-26, AC-27, AC-29 … AC-31, AC-33; С7, С8), ring 1: pure. Money is
 * integer micro-dollars everywhere (no float drift); prices are integer micro-dollars per million
 * tokens, parsed once from the configuration's decimal strings (USD per million tokens).
 */

/** Token counts as the provider port normalises them (DeepSeek: cache miss → input, hit → cacheRead). */
export interface SpendUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Micro-dollars per million tokens, per usage field. */
export interface ProviderPrices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type SpendProvider = 'anthropic' | 'deepseek';
export type AiPrices = Record<SpendProvider, ProviderPrices>;

/** What was sent: the upper estimate of a call without `usage` (AC-27). */
export interface SpendRequest {
  /** Length of the request text, in characters. */
  chars: number;
  /** The request's `max_tokens`. */
  maxTokens: number;
}

export const MICROS_PER_USD = 1_000_000;
const PER_MILLION = 1_000_000;

/** `"0.125"` (USD per million tokens) → 125 000 micro-dollars per million tokens; digits past the 6th round up. */
export function parseUsdPerMTok(value: string): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`price: not a decimal: ${value}`);
  const whole = Number(m[1]);
  const frac = m[2] ?? '';
  const six = Number(frac.slice(0, 6).padEnd(6, '0'));
  const rest = /[1-9]/.test(frac.slice(6)) ? 1 : 0;
  return whole * MICROS_PER_USD + six + rest;
}

/** The configuration's price strings → integer prices. DeepSeek is always priced at peak (С8). */
export function aiPricesFrom(env: {
  anthropic: { input: string; output: string; cacheRead: string; cacheWrite: string };
  deepseek: { cacheMiss: string; cacheHit: string; output: string };
}): AiPrices {
  return {
    anthropic: {
      input: parseUsdPerMTok(env.anthropic.input),
      output: parseUsdPerMTok(env.anthropic.output),
      cacheRead: parseUsdPerMTok(env.anthropic.cacheRead),
      cacheWrite: parseUsdPerMTok(env.anthropic.cacheWrite),
    },
    deepseek: {
      input: parseUsdPerMTok(env.deepseek.cacheMiss),
      output: parseUsdPerMTok(env.deepseek.output),
      cacheRead: parseUsdPerMTok(env.deepseek.cacheHit),
      cacheWrite: 0,
    },
  };
}

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * Cost of one answered call, micro-dollars, rounded up. With `usage`: every field × its price
 * (reasoning tokens are already part of `output`, AC-26). Without: input = request characters,
 * output = `max_tokens`, at the input and output prices (upper estimate, AC-27).
 */
export function costMicros(provider: SpendProvider, usage: SpendUsage | undefined, request: SpendRequest, prices: AiPrices): number {
  const p = prices[provider];
  const u: SpendUsage = usage ?? { input: count(request.chars), output: count(request.maxTokens), cacheRead: 0, cacheWrite: 0 };
  const scaled = count(u.input) * p.input + count(u.output) * p.output + count(u.cacheRead) * p.cacheRead + count(u.cacheWrite) * p.cacheWrite;
  return Math.ceil(scaled / PER_MILLION);
}

export interface Periods {
  /** `month:YYYY-MM`, calendar month UTC. */
  month: string;
  /** `night:YYYY` (year of 31.12) inside [31.12 08:00, 01.01 14:00) UTC, else null (AC-33). */
  night: string | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The spend buckets of an instant of the clock port (AC-33). The month edge never touches the night key. */
export function periodsAt(nowMs: number): Periods {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const month = `month:${y}-${pad2(mo + 1)}`;
  const nightStart = Date.UTC(y, 11, 31, 8);
  const nightEnd = Date.UTC(y, 0, 1, 14);
  let night: string | null = null;
  if (nowMs >= nightStart) night = `night:${y}`;
  else if (nowMs < nightEnd) night = `night:${y - 1}`;
  return { month, night };
}

/** The night key an instant belongs to, or the coming night's key outside it (test door `setSpend`). */
export function nightKeyNear(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  return `night:${d.getUTCMonth() === 0 ? y - 1 : y}`;
}

export type SpendLevel = 50 | 80 | 100;
export const SPEND_LEVELS: readonly SpendLevel[] = [50, 80, 100];

/** Levels of the ceiling that `totalMicros` has reached (≥ level% of the ceiling). */
export function levelsAt(totalMicros: number, ceilingMicros: number): SpendLevel[] {
  if (!(ceilingMicros > 0)) return [];
  return SPEND_LEVELS.filter((l) => totalMicros * 100 >= ceilingMicros * l);
}

/** Levels newly crossed going from `before` to `after` against one ceiling. */
export function crossed(beforeMicros: number, afterMicros: number, ceilingMicros: number): SpendLevel[] {
  const was = new Set(levelsAt(beforeMicros, ceilingMicros));
  return levelsAt(afterMicros, ceilingMicros).filter((l) => !was.has(l));
}

export const usdToMicros = (usd: number): number => Math.round(usd * MICROS_PER_USD);
export const microsToUsd = (micros: number): number => micros / MICROS_PER_USD;
