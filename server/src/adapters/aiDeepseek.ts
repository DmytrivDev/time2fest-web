/**
 * DeepSeek adapter, OpenAI-compatible wire (ring 4, SPEC-09 AC-44, AC-45). Sends exactly: model,
 * messages, max_tokens, and for moderation response_format json_object; headers Authorization and
 * content-type. Reads the raw answer string and the usage; parsing the score is the domain's.
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

export interface DeepseekConfig {
  url: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs?: number;
}

export const DEEPSEEK_MODERATION_MAX_TOKENS = 32;
export const DEEPSEEK_TRANSLATION_MAX_TOKENS = 400;

/**
 * DeepSeek rejects a text it considers risky with HTTP 400 and the message "Content Exists Risk"
 * (security S1). Matched conservatively on that phrase only; every other 400 stays `http`.
 */
export function isContentRisk(errorBody: unknown): boolean {
  const message = asRecord(asRecord(errorBody)?.error)?.message;
  return typeof message === 'string' && /content exists risk/i.test(message);
}

function parse(json: unknown): { text: string; usage?: TokenUsage } | undefined {
  const root = asRecord(json);
  const choices = root?.choices;
  if (!Array.isArray(choices)) return undefined;
  const message = asRecord(asRecord(choices[0])?.message);
  if (message === undefined || typeof message.content !== 'string') return undefined;
  const u = asRecord(root?.usage);
  const usage =
    u === undefined
      ? undefined
      : {
          // Without the miss count, everything not read from the cache is billed as plain input.
          input:
            u.prompt_cache_miss_tokens === undefined
              ? Math.max(0, count(u.prompt_tokens) - count(u.prompt_cache_hit_tokens))
              : count(u.prompt_cache_miss_tokens),
          output: count(u.completion_tokens),
          cacheRead: count(u.prompt_cache_hit_tokens),
          cacheWrite: 0,
        };
  return { text: message.content, ...(usage === undefined ? {} : { usage }) };
}

export function createDeepseekProvider(config: DeepseekConfig): AiProvider {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const call = async (
    { system, user }: { system: string; user: string },
    maxTokens: number,
    json: boolean,
    signal: AbortSignal,
  ): Promise<ProviderAnswer<{ raw: string }>> => {
    if (config.apiKey === undefined) return { ok: false, kind: 'not-configured' };
    const answer = await postJson({
      url: `${config.url.replace(/\/+$/, '')}/chat/completions`,
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: {
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      },
      signal,
      timeoutMs,
      contentRefusal: isContentRisk,
    });
    if (!answer.ok) return answer;
    const parsed = parse(answer.value);
    if (parsed === undefined) return { ok: false, kind: 'malformed' };
    return { ok: true, value: { raw: parsed.text }, ms: answer.ms, ...(parsed.usage === undefined ? {} : { usage: parsed.usage }) };
  };

  const moderate: AiProvider['moderate'] = (text, lang, signal) =>
    call(
      prompt(moderationInstruction, text, lang === undefined ? undefined : `Language: ${lang}`),
      DEEPSEEK_MODERATION_MAX_TOKENS,
      true,
      signal,
    );

  return {
    id: 'deepseek',
    configured: config.apiKey !== undefined,
    moderate,
    async translate({ text, to, from }, signal) {
      const langLine = `Translate ${from === undefined ? '' : `from ${from} `}to ${to}.`;
      const answer = await call(prompt(translationInstruction, text, langLine), DEEPSEEK_TRANSLATION_MAX_TOKENS, false, signal);
      return answer.ok ? { ...answer, value: { text: answer.value.raw } } : answer;
    },
    probe: (signal) => moderate('ping', undefined, signal),
  };
}
