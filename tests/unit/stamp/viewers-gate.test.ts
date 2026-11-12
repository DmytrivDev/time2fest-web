// Чесне число (рішення власника 2026-11-12): імітовані «Зараз дивляться люди з 140 країн» — лише в тестовій і демо-збірці;
// у робочій збірці без справжніх даних присутності — порожньо (рядок і шар мапи не показуються).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getData } from '@/lib/data/load';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('@/lib/env');
});

describe('імітована присутність', () => {
  it('робоча збірка — жодної імітованої країни; тестова й демо — 140', async () => {
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: false, IS_DEMO_BUILD: false }));
    const prod = await import('@/lib/presence/viewers');
    expect(prod.SIMULATED_PRESENCE).toBe(false);
    expect(prod.currentViewers(getData())).toEqual([]);
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: true, IS_DEMO_BUILD: true }));
    const demo = await import('@/lib/presence/viewers');
    expect(demo.SIMULATED_PRESENCE).toBe(true);
    expect(demo.currentViewers(getData())).toHaveLength(Math.min(demo.SIMULATED_VIEWER_COUNTRIES, getData().countries.length));
  });

  it('та сама межа, що в імітованих тостів', async () => {
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: false, IS_DEMO_BUILD: false }));
    const viewers = await import('@/lib/presence/viewers');
    const toasts = await import('@/lib/toast/worldToasts');
    expect(viewers.SIMULATED_PRESENCE).toBe(toasts.SIMULATED_TOASTS);
  });
});
