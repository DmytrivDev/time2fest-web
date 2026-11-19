/**
 * SPEC-09 W28: the translation service as the composition root builds it, against the fake AI (in this
 * process on port 0) and this worktree's Postgres (the spend bucket of the ceiling case). AC-22 … AC-25.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAi } from '../../../fakes/ai/server.mjs';
import { moderationOf } from '../../src/endpoints/deps';
import type { ModerationDeps } from '../../src/endpoints/types';
import { testDeps } from './helpers';

const KEY = 'fake-key-for-tests'; // check-secrets: allow test fake
let url = '';
let close: () => Promise<void>;
let m: ModerationDeps;

const control = (provider: 'anthropic' | 'deepseek', knobs: unknown) =>
  fetch(`${url}/_control/${provider}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(knobs) });
const requests = async () => (await (await fetch(`${url}/_control/requests`)).json()) as { provider: string; at: number }[];

beforeAll(async () => {
  ({ url, close } = await startFakeAi({ port: 0 }));
  m = moderationOf(
    testDeps({}, { T2F_AI_ANTHROPIC_URL: url, T2F_AI_DEEPSEEK_URL: url, ANTHROPIC_API_KEY: KEY, DEEPSEEK_API_KEY: KEY }),
  );
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await fetch(`${url}/_control/reset`, { method: 'POST' });
  m.spend.reset();
  m.layer.reset();
});

describe('SPEC-09 translation service', () => {
  it('AC-22: the primary (Anthropic) translates', async () => {
    await control('anthropic', { translation: 'Happy New Year!' });
    expect(await m.translate.translate({ text: 'З Новим роком!', to: 'en', from: 'uk' })).toEqual({ ok: true, text: 'Happy New Year!', source: 'primary' });
    expect((await requests()).map((r) => r.provider)).toEqual(['anthropic']);
  });

  it('AC-23: primary 10 s slow → the backup is asked ≤ 3 s from the start and its translation returned', async () => {
    await control('anthropic', { delayMs: 10_000 });
    await control('deepseek', { translation: 'Bonne année !' });
    const start = Date.now();
    expect(await m.translate.translate({ text: 'Happy New Year', to: 'fr' })).toEqual({ ok: true, text: 'Bonne année !', source: 'backup' });
    const backup = (await requests()).find((r) => r.provider === 'deepseek');
    expect(backup).toBeDefined();
    expect(backup!.at - start).toBeLessThanOrEqual(3_000);
  });

  it('AC-24: a new link in the output is a provider error → backup; both so → unavailable', async () => {
    await control('anthropic', { translation: 'Visit evil.com now' });
    await control('deepseek', { translation: 'Привіт усім' });
    expect(await m.translate.translate({ text: 'Hello everyone', to: 'uk' })).toEqual({ ok: true, text: 'Привіт усім', source: 'backup' });
    await control('deepseek', { translation: 'пишіть на evil.com' });
    expect(await m.translate.translate({ text: 'Hello everyone', to: 'uk' })).toEqual({ ok: false, reason: 'unavailable' });
    await control('deepseek', { corrupt: 'empty' });
    expect(await m.translate.translate({ text: 'Hello everyone', to: 'uk' })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('S1: both refuse the content 10 times → unavailable each time, both providers stay available', async () => {
    await control('anthropic', { refuse: true });
    await control('deepseek', { refuse: true });
    for (let i = 0; i < 10; i++) {
      expect(await m.translate.translate({ text: `crafted ${i}`, to: 'uk' })).toEqual({ ok: false, reason: 'unavailable' });
    }
    expect(m.layer.state('translation').state).toBe('available');
    expect(m.layer.usable('translation').map((p) => p.id)).toEqual(['anthropic', 'deepseek']);
  });

  it('AC-25: both answer 503 → unavailable, no made-up translation', async () => {
    await control('anthropic', { down: 503 });
    await control('deepseek', { down: 503 });
    expect(await m.translate.translate({ text: 'Hello', to: 'uk' })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('AC-25: spend ceiling reached → unavailable with no request to the fake', async () => {
    await m.spend.setSpendForDoor('month', 1_000_000);
    try {
      expect(m.layer.state('translation')).toEqual({ task: 'translation', state: 'fallback', reason: 'ceiling' });
      expect(await m.translate.translate({ text: 'Hello', to: 'uk' })).toEqual({ ok: false, reason: 'unavailable' });
      expect(await requests()).toHaveLength(0);
    } finally {
      await m.spend.setSpendForDoor('month', 0);
    }
  });

  it('invalid input (language code, length) → invalid-input with no request', async () => {
    expect(await m.translate.translate({ text: 'Hello', to: 'english' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await m.translate.translate({ text: 'Hello', to: 'uk', from: 'UK' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await m.translate.translate({ text: 'x'.repeat(201), to: 'uk' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await requests()).toHaveLength(0);
  });
});
