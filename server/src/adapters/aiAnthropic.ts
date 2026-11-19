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
  MODERATION_INSTRUCTION,
  postJson,
  TRANSLATION_INSTRUCTION,
  wrapText,
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

function parse(json: unknown): { text: string; usage?: TokenUsage } | undefined {
  const root = asRecord(json);
  const content = root?.content;
  if (!Array.isArray(content)) return undefined;
  const first = asRecord(content[0]);
  if (first === undefined || typeof first.text !== 'string') return undefined;
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
    system: string,
    user: string,
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
    return { ok: true, value: { raw: parsed.text }, ms: answer.ms, ...(parsed.usage === undefined ? {} : { usage: parsed.usage }) };
  };

  const moderate: AiProvider['moderate'] = (text, lang, signal) =>
    call(
      MODERATION_INSTRUCTION,
      wrapText(text, lang === undefined ? undefined : `Language: ${lang}`),
      ANTHROPIC_MODERATION_MAX_TOKENS,
      signal,
    );

  return {
    id: 'anthropic',
    configured: config.apiKey !== undefined,
    moderate,
    async translate({ text, to, from }, signal) {
      const langLine = `Translate ${from === undefined ? '' : `from ${from} `}to ${to}.`;
      const answer = await call(TRANSLATION_INSTRUCTION, wrapText(text, langLine), ANTHROPIC_TRANSLATION_MAX_TOKENS, signal);
      return answer.ok ? { ...answer, value: { text: answer.value.raw } } : answer;
    },
    probe: (signal) => moderate('ping', undefined, signal),
  };
}
