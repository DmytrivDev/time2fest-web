/**
 * Moderation ports (ring 2, SPEC-09): what the domain asks of an AI provider. Speaks text, language
 * and task only; no vendor type, header or field name crosses this line.
 */

/** Token counts normalised across providers (cache hit/miss counted apart from plain input). */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type ProviderFailureKind = 'http' | 'timeout' | 'malformed' | 'not-configured';

export type ProviderAnswer<T> =
  | { ok: true; value: T; usage?: TokenUsage; ms: number }
  | { ok: false; kind: ProviderFailureKind; status?: number };

/** The model's raw answer to a moderation task; the strict score parse lives in the domain. */
export interface ModerationRaw {
  raw: string;
}

export interface TranslationInput {
  text: string;
  to: string;
  from?: string;
}

export interface AiProvider {
  readonly id: 'anthropic' | 'deepseek';
  /** False when the key is absent: every call answers `not-configured` without a network request. */
  readonly configured: boolean;
  moderate(text: string, lang: string | undefined, signal: AbortSignal): Promise<ProviderAnswer<ModerationRaw>>;
  translate(input: TranslationInput, signal: AbortSignal): Promise<ProviderAnswer<{ text: string }>>;
  /** A minimal real call that checks the provider answers (health). */
  probe(signal: AbortSignal): Promise<ProviderAnswer<ModerationRaw>>;
}
