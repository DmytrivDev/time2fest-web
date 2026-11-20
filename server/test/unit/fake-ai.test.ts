/** SPEC-09 AC-49: the fake AI speaks both wire formats and obeys its control knobs. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAi } from '../../../fakes/ai/server.mjs';

let url = '';
let close: () => Promise<void>;

beforeAll(async () => {
  ({ url, close } = await startFakeAi({ port: 0 }));
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await fetch(`${url}/_control/reset`, { method: 'POST' });
});

const post = (path: string, body: unknown) =>
  fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const control = (provider: string, knobs: unknown) => post(`/_control/${provider}`, knobs);

const anthropicBody = (text: string, system = 'rate it') => ({
  model: 'm',
  system,
  messages: [{ role: 'user', content: `<<<T2F_TEXT\n${text}\nT2F_TEXT>>>` }],
});
const deepseekBody = (text: string, system = 'rate it') => ({
  model: 'm',
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: `<<<T2F_TEXT\n${text}\nT2F_TEXT>>>` },
  ],
});

type AnthropicAnswer = { content: { text: string }[]; usage?: Record<string, number> };
type DeepseekAnswer = { choices: { message: { content: string } }[]; usage?: Record<string, number> };

describe('fake AI', () => {
  it('answers the Anthropic Messages format with usage', async () => {
    const json = (await (await post('/v1/messages', anthropicBody('hello'))).json()) as AnthropicAnswer;
    expect(JSON.parse(json.content[0]!.text)).toEqual({ score: 0 });
    expect(Object.keys(json.usage!).sort()).toEqual([
      'cache_creation_input_tokens',
      'cache_read_input_tokens',
      'input_tokens',
      'output_tokens',
    ]);
  });

  it('answers the DeepSeek format with usage', async () => {
    const json = (await (await post('/chat/completions', deepseekBody('hello'))).json()) as DeepseekAnswer;
    expect(JSON.parse(json.choices[0]!.message.content)).toEqual({ score: 0 });
    expect(Object.keys(json.usage!).sort()).toEqual(['completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']);
  });

  it('scores by a marker found in the delimited text only', async () => {
    await control('anthropic', { score: [{ marker: 'BAD', score: 0.9 }] });
    const hit = (await (await post('/v1/messages', anthropicBody('xx BAD xx'))).json()) as AnthropicAnswer;
    expect(JSON.parse(hit.content[0]!.text).score).toBe(0.9);
    const outside = { ...anthropicBody('fine'), system: 'BAD' };
    const miss = (await (await post('/v1/messages', outside)).json()) as AnthropicAnswer;
    expect(JSON.parse(miss.content[0]!.text).score).toBe(0);
  });

  it('translation, corrupt, usage null and down knobs', async () => {
    await control('deepseek', { translation: 'Hola' });
    const t = (await (await post('/chat/completions', deepseekBody('Hi', 'translate it'))).json()) as DeepseekAnswer;
    expect(t.choices[0]!.message.content).toBe('Hola');

    await control('deepseek', { corrupt: 'out-of-range', usage: null });
    const c = (await (await post('/chat/completions', deepseekBody('x'))).json()) as DeepseekAnswer;
    expect(JSON.parse(c.choices[0]!.message.content).score).toBe(7);
    expect(c.usage).toBeUndefined();

    await control('anthropic', { down: 529 });
    expect((await post('/v1/messages', anthropicBody('x'))).status).toBe(529);
    expect((await post('/chat/completions', deepseekBody('x'))).status).toBe(200);
  });

  it('delays by delayMs and fails by errorRate', async () => {
    await control('anthropic', { delayMs: 120 });
    const t0 = Date.now();
    await post('/v1/messages', anthropicBody('x'));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    await control('anthropic', { delayMs: 0, errorRate: 1 });
    expect((await post('/v1/messages', anthropicBody('x'))).status).toBe(500);
  });

  it('keeps the last 100 requests and reset clears them', async () => {
    for (let i = 0; i < 105; i++) await post('/v1/messages', anthropicBody(`m${i}`));
    const list = (await (await fetch(`${url}/_control/requests`)).json()) as {
      provider: string;
      path: string;
      body: { messages: { content: string }[] };
    }[];
    expect(list).toHaveLength(100);
    expect(list[99]!.body.messages[0]!.content).toContain('m104');
    expect(list[0]).toMatchObject({ provider: 'anthropic', path: '/v1/messages' });
    await fetch(`${url}/_control/reset`, { method: 'POST' });
    expect(await (await fetch(`${url}/_control/requests`)).json()).toEqual([]);
  });
});
