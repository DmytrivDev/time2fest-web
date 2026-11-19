/**
 * Verdict service (SPEC-09 AC-10 … AC-16), ring 3. Order of one verdict:
 *
 * 1. the shared rules of the text's kind: a violation is `block` / `rules`, no provider call (AC-10, С19);
 * 2. the providers the layer calls usable now, in order (primary, then backup), 1 s each and 2 s in
 *    total; an answer that is not the strict `{"score": 0..1}` is a provider error (AC-12, AC-14);
 * 3. no usable answer, or the task in `fallback`: the fallback filter, `source: 'fallback'` (AC-13).
 *
 * Fail-closed: an error never becomes `allow` from a provider. A nick's AI `block` / `review` carries the
 * reason `forbidden` (AC-15). `recheck` answers from a provider only, else `unavailable` (AC-16).
 * Ports and pure rules arrive as parameters; the time budget is read on the injected monotonic clock.
 */
import type { TextKind } from '@time2fest/rules/text';
import { outcomeOf, type Outcome } from '../domain/moderation/verdict';
import { parseScore } from '../domain/moderation/output';
import type { ModerationSettings } from '../domain/moderation/settings';
import type { SpendRequest } from '../domain/moderation/spend';
import type { Clock } from '../ports';
import type { AiProvider, ProviderAnswer, TokenUsage } from './ports';
import type { ProviderId, ProviderLayer } from './providers';

export type { TextKind };
export type VerdictSource = 'rules' | 'primary' | 'backup' | 'fallback';

export interface VerdictInput {
  kind: TextKind;
  text: string;
  lang?: string;
}

export interface Verdict {
  outcome: Outcome;
  source: VerdictSource;
  reason?: string;
}

export type RecheckResult = Verdict | { outcome: 'unavailable' };

export interface VerdictService {
  verdict(input: VerdictInput): Promise<Verdict>;
  recheck(input: VerdictInput): Promise<RecheckResult>;
}

export interface VerdictDeps {
  layer: Pick<ProviderLayer, 'usable' | 'state' | 'call'>;
  spend: {
    record(provider: ProviderId, usage: TokenUsage | undefined, request: SpendRequest): void;
    settings(): ModerationSettings;
  };
  /** `textRulesFor` of `@time2fest/rules/text`. */
  rules: (kind: TextKind, text: string) => { reason: string } | null;
  /** `fallbackVerdict` of `@time2fest/rules/text/fallback`. */
  fallback: (kind: TextKind, text: string) => 'allow' | 'block';
  /** Monotonic, ms. */
  clock: Clock;
  /** The moderation primary (its answers are `source: 'primary'`, every other `backup`). */
  primary: ProviderId;
  /** The moderation `max_tokens` of the adapters (spend estimate of a call without `usage`, AC-27). */
  maxTokens: number;
  perCallMs?: number;
  budgetMs?: number;
}

/** One provider's wait (AC-12). */
export const PER_CALL_MS = 1_000;
/** All providers together; the fallback filter is synchronous, so the verdict stays ≤ 2.2 s (AC-13). */
export const PROVIDER_BUDGET_MS = 2_000;

const timedOut = <T>(): ProviderAnswer<T> => ({ ok: false, kind: 'timeout' });

/** Resolves with a `timeout` failure when `signal` aborts, whatever the provider does afterwards. */
export function bounded<T>(work: Promise<ProviderAnswer<T>>, signal: AbortSignal): Promise<ProviderAnswer<T>> {
  if (signal.aborted) return Promise.resolve(timedOut<T>());
  return new Promise((resolve) => {
    const onAbort = () => resolve(timedOut<T>());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (answer) => {
        signal.removeEventListener('abort', onAbort);
        resolve(answer);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve({ ok: false, kind: 'http' });
      },
    );
  });
}

export function createVerdictService({
  layer,
  spend,
  rules,
  fallback,
  clock,
  primary,
  maxTokens,
  perCallMs = PER_CALL_MS,
  budgetMs = PROVIDER_BUDGET_MS,
}: VerdictDeps): VerdictService {
  /** The first strict score of a usable provider, or `null` (none usable, all failed, budget spent). */
  async function ask(text: string, lang: string | undefined): Promise<{ score: number; source: 'primary' | 'backup' } | null> {
    if (layer.state('moderation').state === 'fallback') return null;
    const started = clock.now();
    const request: SpendRequest = { chars: text.length, maxTokens };
    for (const provider of layer.usable('moderation')) {
      const left = budgetMs - (clock.now() - started);
      if (left <= 0) break;
      const signal = AbortSignal.timeout(Math.max(1, Math.floor(Math.min(perCallMs, left))));
      const answer = await layer.call(
        'moderation',
        provider,
        async () => {
          const a = await bounded(provider.moderate(text, lang, signal), signal);
          // Inside `run`: a rejected (malformed) answer was still billed.
          if (a.ok) spend.record(provider.id, a.usage, request);
          return a;
        },
        (v) => parseScore(v.raw) !== null,
      );
      if (!answer.ok) continue;
      const score = parseScore(answer.value.raw);
      if (score === null) continue;
      return { score, source: sourceOf(provider) };
    }
    return null;
  }

  const sourceOf = (p: AiProvider): 'primary' | 'backup' => (p.id === primary ? 'primary' : 'backup');

  function fromScore(kind: TextKind, score: number, source: 'primary' | 'backup'): Verdict {
    const s = spend.settings();
    const outcome = outcomeOf(score, { review: s.reviewThreshold, block: s.blockThreshold });
    if (kind === 'nick' && outcome !== 'allow') return { outcome, source, reason: 'forbidden' };
    return { outcome, source };
  }

  function byRules(kind: TextKind, text: string): Verdict | null {
    const rule = rules(kind, text);
    return rule ? { outcome: 'block', source: 'rules', reason: rule.reason } : null;
  }

  return {
    async verdict({ kind, text, lang }) {
      const ruled = byRules(kind, text);
      if (ruled) return ruled;
      const ai = await ask(text, lang);
      if (ai) return fromScore(kind, ai.score, ai.source);
      if (fallback(kind, text) === 'allow') return { outcome: 'allow', source: 'fallback' };
      return kind === 'nick' ? { outcome: 'block', source: 'fallback', reason: 'forbidden' } : { outcome: 'block', source: 'fallback' };
    },
    async recheck({ kind, text, lang }) {
      const ruled = byRules(kind, text);
      if (ruled) return ruled;
      const ai = await ask(text, lang);
      return ai ? fromScore(kind, ai.score, ai.source) : { outcome: 'unavailable' };
    },
  };
}
