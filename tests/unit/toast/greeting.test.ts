/**
 * Привітання опівночі в чаті й імітовані тости (рішення власника 2026-11-12): «Світ» і чати країн поясу; ніки тих, хто
 * сказав тост на $10 до цієї півночі; імітовані тости — лише в тестовій і демо-збірці.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getData } from '@/lib/data/load';
import type { ChatScriptFile } from '@/lib/data/types';
import type { ToastRecord } from '@/lib/toast/feed';
import { toastGreetingMessages, zoneCountryIsos } from '@/lib/toast/greeting';
import { worldToasts } from '@/lib/toast/worldToasts';
import chatScript from '@/data/chat-script.json';

const data = getData();
const zones = [...data.zones].sort((a, b) => a.midnightMs - b.midnightMs);
const paris = zones.find((z) => zoneCountryIsos(data, z.id).includes('FR'))!;
const prev = zones[zones.indexOf(paris) - 1]!;
const own = (tier: 2 | 5 | 10, at: number, nick: string): ToastRecord => ({ id: `own-${nick}-${at}`, nick, flagCode: 'UA', text: 'Тост', tier, createdAt: at, mine: true });

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/env');
});

describe('привітання опівночі', () => {
  it('о півночі поясу — у «Світі» й у чаті країни поясу; ніки — хто сказав $10 між попередньою північчю й цією', () => {
    const toasts = [own(10, paris.midnightMs - 10 * 60_000, 'Олена'), own(5, paris.midnightMs - 5 * 60_000, 'Тарас'), own(10, prev.midnightMs - 60_000, 'Рано')];
    const out = toastGreetingMessages(data, ['world', 'country:FR', 'country:JP'], paris.midnightMs - 1, paris.midnightMs, toasts);
    expect(out.map((m) => m.room).sort()).toEqual(['country:FR', 'world']);
    const sys = out[0]!.system!;
    expect(sys).toMatchObject({ kind: 'toast-midnight', zoneId: paris.id, offsetMinutes: paris.offsetMinutes, toasters: [{ nick: 'Олена', flagCode: 'UA' }] });
    expect(out[0]!.createdAt).toBe(paris.midnightMs);
    expect((sys as { countryIsos: string[] }).countryIsos).toContain('FR');
  });

  it('ніхто не сказав $10 — привітання без ніків; поза проміжком — нічого', () => {
    const out = toastGreetingMessages(data, ['world'], paris.midnightMs - 1, paris.midnightMs, []);
    expect(out).toHaveLength(1);
    expect(out[0]!.system).toMatchObject({ toasters: [] });
    expect(toastGreetingMessages(data, ['world'], paris.midnightMs, paris.midnightMs + 60_000, [])).toEqual([]);
  });
});

describe('імітовані тости', () => {
  it('рівні $2 / $5 / $10, після півночей, за часом; автори — зі сценарію чату', () => {
    const all = worldToasts(chatScript as unknown as ChatScriptFile, data);
    expect(all.length).toBeGreaterThan(data.zones.length);
    expect(new Set(all.map((t) => t.tier))).toEqual(new Set([2, 5, 10]));
    expect(all.every((t, i) => i === 0 || all[i - 1]!.createdAt <= t.createdAt)).toBe(true);
    expect(worldToasts(chatScript as unknown as ChatScriptFile, data, paris.midnightMs).every((t) => t.createdAt <= paris.midnightMs)).toBe(true);
  });

  it('робоча збірка — жодного імітованого тосту (смуга порожня); тестова й демо — є', async () => {
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: false, IS_DEMO_BUILD: false }));
    const prod = await import('@/lib/toast/worldToasts');
    expect(prod.SIMULATED_TOASTS).toBe(false);
    expect(prod.simulatedToasts(chatScript as unknown as ChatScriptFile, data)).toEqual([]);
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: true, IS_DEMO_BUILD: false }));
    const test = await import('@/lib/toast/worldToasts');
    expect(test.simulatedToasts(chatScript as unknown as ChatScriptFile, data).length).toBeGreaterThan(0);
  });
});
