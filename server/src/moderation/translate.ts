/**
 * Translation service (SPEC-09 AC-22 … AC-25), ring 3.
 *
 * - Input: text ≤ 200 characters, `to` and optional `from` as `^[a-z]{2,3}(-[A-Z]{2})?$`; else `invalid-input`.
 * - Task in `fallback` (both down, or the spend ceiling): `unavailable` without a request (AC-25).
 * - The primary waits 2.5 s; on its error or timeout the backup starts at once (so ≤ 3 s from the start,
 *   AC-23) and waits up to 3 s, within 6 s overall. A wrong output (empty, > 600 characters, a new link
 *   or contact) is a provider error (AC-24). No answer → `unavailable`; never a made-up translation.
 * Spend is recorded inside the provider call, so a rejected answer still counts.
 */
import { MAX_TEXT } from '@time2fest/rules/text';
import { checkTranslation } from '../domain/moderation/output';
import type { SpendRequest } from '../domain/moderation/spend';
import type { Clock } from '../ports';
import type { TokenUsage, TranslationInput } from './ports';
import type { ProviderId, ProviderLayer } from './providers';
import { bounded } from './verdict';

export type TranslationResult =
  | { ok: true; text: string; source: 'primary' | 'backup' }
  | { ok: false; reason: 'invalid-input' | 'unavailable' };

export interface TranslationService {
  translate(input: TranslationInput): Promise<TranslationResult>;
}

export interface TranslationDeps {
  layer: Pick<ProviderLayer, 'usable' | 'state' | 'call'>;
  spend: { record(provider: ProviderId, usage: TokenUsage | undefined, request: SpendRequest): void };
  /** Monotonic, ms. */
  clock: Clock;
  /** The translation primary. */
  primary: ProviderId;
  /** The translation `max_tokens` of the adapters (spend estimate without `usage`). */
  maxTokens: number;
  primaryMs?: number;
  backupMs?: number;
  totalMs?: number;
}

export const PRIMARY_MS = 2_500;
export const BACKUP_MS = 3_000;
export const TOTAL_MS = 6_000;
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export function validTranslationInput({ text, to, from }: TranslationInput): boolean {
  if (typeof text !== 'string' || text.trim() === '' || [...text].length > MAX_TEXT) return false;
  if (typeof to !== 'string' || !LANG.test(to)) return false;
  return from === undefined || (typeof from === 'string' && LANG.test(from));
}

export function createTranslationService({
  layer,
  spend,
  clock,
  primary,
  maxTokens,
  primaryMs = PRIMARY_MS,
  backupMs = BACKUP_MS,
  totalMs = TOTAL_MS,
}: TranslationDeps): TranslationService {
  return {
    async translate(input) {
      if (!validTranslationInput(input)) return { ok: false, reason: 'invalid-input' };
      if (layer.state('translation').state === 'fallback') return { ok: false, reason: 'unavailable' };
      const started = clock.now();
      const request: SpendRequest = { chars: input.text.length, maxTokens };
      for (const provider of layer.usable('translation')) {
        const isPrimary = provider.id === primary;
        const left = totalMs - (clock.now() - started);
        if (left <= 0) break;
        const signal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(isPrimary ? primaryMs : backupMs, left))));
        const answer = await layer.call(
          'translation',
          provider,
          async () => {
            const a = await bounded(provider.translate(input, signal), signal);
            if (a.ok) spend.record(provider.id, a.usage, request);
            return a;
          },
          (v) => checkTranslation(input.text, v.text) === null,
        );
        if (answer.ok) return { ok: true, text: answer.value.text, source: isPrimary ? 'primary' : 'backup' };
      }
      return { ok: false, reason: 'unavailable' };
    },
  };
}
