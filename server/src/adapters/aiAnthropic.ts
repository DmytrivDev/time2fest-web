/**
 * Anthropic Messages adapter (ring 4, SPEC-09 AC-44, AC-45). Sends exactly: model, max_tokens,
 * thinking, system, messages; headers x-api-key, anthropic-version, content-type. No metadata,
 * temperature or sampling fields. Reads the raw answer string and the usage; parsing is the domain's.
 */
import type { AiProvider, ProviderAnswer, TokenUsage } from '../moderation/ports';
import {
  asRecord,
  count,
  DEFAULT_TIMEOUT_MS,
  moderationInstruction,
  postJson,
  prompt,
  translationInstruction,
} from './aiHttp';

export interface AnthropicConfig {
  url: string;
  apiKey: string | undefined;
  model: string;
  version: string;
  timeoutMs?: number;
}

export const ANTHROPIC_MODERATION_MAX_TOKENS = 32;
export const ANTHROPIC_TRANSLATION_MAX_TOKENS = 400;

/**
 * The text and usage of a Messages answer; `'refused'` when the model declined the content
 * (`stop_reason: "refusal"`, or a readable envelope with no text block first — security S1);
 * `undefined` when the envelope itself is unreadable.
 */
function parse(json: unknown): { text: string; usage?: TokenUsage } | 'refused' | undefined {
  const root = asRecord(json);
  const content = root?.content;
  if (!Array.isArray(content)) return undefined;
  if (root?.stop_reason === 'refusal') return 'refused';
  const first = asRecord(content[0]);
  if (first === undefined || first.type !== 'text' || typeof first.text !== 'string') return 'refused';
  const u = asRecord(root?.usage);
  const usage =
    u === undefined
      ? undefined
      : {
          input: count(u.input_tokens),
          output: count(u.output_tokens),
          cacheRead: count(u.cache_read_input_tokens),
          cacheWrite: count(u.cache_creation_input_tokens),
        };
  return { text: first.text, ...(usage === undefined ? {} : { usage }) };
}

export function createAnthropicProvider(config: AnthropicConfig): AiProvider {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const call = async (
    { system, user }: { system: string; user: string },
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<ProviderAnswer<{ raw: string }>> => {
    if (config.apiKey === undefined) return { ok: false, kind: 'not-configured' };
    const answer = await postJson({
      url: `${config.url.replace(/\/+$/, '')}/v1/messages`,
      headers: { 'x-api-key': config.apiKey, 'anthropic-version': config.version, 'content-type': 'application/json' },
      body: {
        model: config.model,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        system,
        messages: [{ role: 'user', content: user }],
      },
      signal,
      timeoutMs,
    });
    if (!answer.ok) return answer;
    const parsed = parse(answer.value);
    if (parsed === undefined) return { ok: false, kind: 'malformed' };
    if (parsed === 'refused') return { ok: false, kind: 'refused' };
    return { ok: true, value: { raw: parsed.text }, ms: answer.ms, ...(parsed.usage === undefined ? {} : { usage: parsed.usage }) };
  };

  const moderate: AiProvider['moderate'] = (text, lang, signal) =>
    call(
      prompt(moderationInstruction, text, lang === undefined ? undefined : `Language: ${lang}`),
      ANTHROPIC_MODERATION_MAX_TOKENS,
      signal,
    );

  return {
    id: 'anthropic',
    configured: config.apiKey !== undefined,
    moderate,
    async translate({ text, to, from }, signal) {
      const langLine = `Translate ${from === undefined ? '' : `from ${from} `}to ${to}.`;
      const answer = await call(prompt(translationInstruction, text, langLine), ANTHROPIC_TRANSLATION_MAX_TOKENS, signal);
      return answer.ok ? { ...answer, value: { text: answer.value.raw } } : answer;
    },
    probe: (signal) => moderate('ping', undefined, signal),
  };
}
