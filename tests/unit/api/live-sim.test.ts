/** Шов: адаптер `sim` ефіру — ланцюжки з каталогу збірки, глядачі й демо-число людей з імітації (лише в тестовій збірці). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyStreamEvent, type LiveService } from '@/lib/api/contracts/live';
import { createSimLive } from '@/lib/api/sim/live';
import { getData } from '@/lib/data/load';
import type { StreamChain, StreamSource } from '@/lib/data/types';
import { currentViewers } from '@/lib/presence/viewers';

const data = getData();
const chainEntry = [...data.chainsByEventId.entries()].find(([, c]) => c.sources.length > 1)!;
const [eventId, chain] = chainEntry;

describe('sim-адаптер ефіру', () => {
  it('chains: усі ланцюжки зі збірки (ті самі об’єкти), версія 0', async () => {
    const all = await createSimLive().chains();
    if (!all.ok) throw new Error(all.error.code);
    expect(all.value.chains).toHaveLength(data.chainsByEventId.size);
    expect(all.value.chains.find((c) => c.eventId === eventId)).toBe(chain);
    expect(all.value.version).toBe(0);
    expect(Number.isNaN(Date.parse(all.value.at))).toBe(false);
  });

  it('AC-4: chains() не приймає параметрів (тип)', () => {
    const svc: LiveService = createSimLive();
    // @ts-expect-error — `?eventIds` прибрано з контракту ([А1]).
    void svc.chains(['x']);
  });

  it('viewers: країни з імітації currentViewers (порожньо у робочій збірці — та сама межа)', async () => {
    const res = await createSimLive().viewers();
    expect(res.ok && res.value.countries).toEqual(currentViewers(data));
    expect(res.ok && Number.isNaN(Date.parse(res.value.at))).toBe(false);
  });

  it('підписки порожні (під час сеансу нічого не змінюється), відписка безпечна; звіт про помилку джерела — ok', async () => {
    const svc = createSimLive();
    const cb = vi.fn();
    svc.subscribeStreams(cb)();
    svc.subscribeViewers(cb)();
    expect(cb).not.toHaveBeenCalled();
    expect(await svc.reportSourceError({ eventId, sourceId: chain.sources[0]!.id, code: 150 })).toEqual({ ok: true, value: undefined });
  });
});

describe('AC-67: демо-число людей лише в тестовій і демо-збірці', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });

  async function simWith(testBuild: boolean) {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: testBuild, IS_DEMO_BUILD: false }));
    const { createSimLive: create } = await import('@/lib/api/sim/live');
    const res = await create().viewers();
    if (!res.ok) throw new Error(res.error.code);
    return res.value;
  }

  it('тестова збірка: people = 12 480', async () => {
    expect((await simWith(true)).people).toBe(12_480);
  });

  it('робоча збірка: people немає, країн немає', async () => {
    const summary = await simWith(false);
    expect('people' in summary).toBe(false);
    expect(summary.countries).toEqual([]);
  });
});

describe('applyStreamEvent (чисте правило контракту, AC-17, AC-18)', () => {
  const chains: ReadonlyMap<string, StreamChain> = data.chainsByEventId;
  const first = chain.sources[0]!;

  it('source: замінює лише це джерело, решта — ті самі об’єкти; мапа нова; версія — події', () => {
    const updated: StreamSource = { ...first, embeddable: !first.embeddable };
    const next = applyStreamEvent(chains, { type: 'source', eventId, source: updated, version: 3 }, 2);
    expect(next.chains).not.toBe(chains);
    expect(next.version).toBe(3);
    const nc = next.chains.get(eventId)!;
    expect(nc.sources[0]).toBe(updated);
    expect(nc.sources.slice(1)).toEqual(chain.sources.slice(1));
    expect(chains.get(eventId)).toBe(chain);
  });

  it('старіша за застосовану версія — та сама мапа, версія не змінюється', () => {
    const updated: StreamSource = { ...first, embeddable: !first.embeddable };
    expect(applyStreamEvent(chains, { type: 'source', eventId, source: updated, version: 4 }, 5)).toEqual({ chains, version: 5 });
  });

  it('source для невідомої події чи невідомого джерела — ігнорується (та сама мапа)', () => {
    expect(applyStreamEvent(chains, { type: 'source', eventId: 'нема', source: first, version: 1 }, 0).chains).toBe(chains);
    expect(applyStreamEvent(chains, { type: 'source', eventId, source: { ...first, id: 'нема-джерела' }, version: 1 }, 0).chains).toBe(chains);
  });

  it('chain: замінює ланцюжок цілком, додає новий', () => {
    const replaced = applyStreamEvent(chains, { type: 'chain', chain: { eventId, sources: [first] }, version: 1 }, 0).chains;
    expect(replaced.get(eventId)!.sources).toEqual([first]);
    const added = applyStreamEvent(chains, { type: 'chain', chain: { eventId: 'нова', sources: [first] }, version: 1 }, 0).chains;
    expect(added.get('нова')).toBeDefined();
    expect(added.size).toBe(chains.size + 1);
  });

  it('hide: прибирає джерело з ланцюжка події', () => {
    const next = applyStreamEvent(chains, { type: 'hide', eventId, sourceId: first.id, version: 1 }, 0).chains;
    expect(next.get(eventId)!.sources.map((s) => s.id)).toEqual(chain.sources.slice(1).map((s) => s.id));
  });
});
