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
  MODERATION_INSTRUCTION,
  postJson,
  TRANSLATION_INSTRUCTION,
  wrapText,
} from './aiHttp';

export interface DeepseekConfig {
  url: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs?: number;
}

export const DEEPSEEK_MODERATION_MAX_TOKENS = 32;
export const DEEPSEEK_TRANSLATION_MAX_TOKENS = 400;

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
          input: count(u.prompt_cache_miss_tokens),
          output: count(u.completion_tokens),
          cacheRead: count(u.prompt_cache_hit_tokens),
          cacheWrite: 0,
        };
  return { text: message.content, ...(usage === undefined ? {} : { usage }) };
}

export function createDeepseekProvider(config: DeepseekConfig): AiProvider {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const call = async (
    system: string,
    user: string,
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
      const answer = await call(TRANSLATION_INSTRUCTION, wrapText(text, langLine), DEEPSEEK_TRANSLATION_MAX_TOKENS, false, signal);
      return answer.ok ? { ...answer, value: { text: answer.value.raw } } : answer;
    },
    probe: (signal) => moderate('ping', undefined, signal),
  };
}
