/** Шов: адаптер `sim` ефіру — ланцюжки з каталогу збірки, глядачі з імітації (лише в тестовій збірці). */
import { describe, expect, it, vi } from 'vitest';
import { applyStreamEvent } from '@/lib/api/contracts/live';
import { createSimLive } from '@/lib/api/sim/live';
import { getData } from '@/lib/data/load';
import type { StreamChain, StreamSource } from '@/lib/data/types';
import { currentViewers } from '@/lib/presence/viewers';

const data = getData();
const chainEntry = [...data.chainsByEventId.entries()].find(([, c]) => c.sources.length > 1)!;
const [eventId, chain] = chainEntry;

describe('sim-адаптер ефіру', () => {
  it('chains: усі ланцюжки зі збірки (ті самі об’єкти) або вибрані за eventId', async () => {
    const svc = createSimLive();
    const all = await svc.chains();
    expect(all.ok && all.value).toHaveLength(data.chainsByEventId.size);
    expect(all.ok && all.value.find((c) => c.eventId === eventId)).toBe(chain);
    const some = await svc.chains([eventId, 'нема-такої']);
    expect(some.ok && some.value).toEqual([chain]);
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

describe('applyStreamEvent (чисте правило контракту)', () => {
  const chains: ReadonlyMap<string, StreamChain> = data.chainsByEventId;
  const first = chain.sources[0]!;

  it('source: замінює лише це джерело, решта — ті самі об’єкти; мапа нова', () => {
    const updated: StreamSource = { ...first, embeddable: !first.embeddable };
    const next = applyStreamEvent(chains, { type: 'source', eventId, source: updated });
    expect(next).not.toBe(chains);
    const nc = next.get(eventId)!;
    expect(nc.sources[0]).toBe(updated);
    expect(nc.sources.slice(1)).toEqual(chain.sources.slice(1));
    expect(chains.get(eventId)).toBe(chain);
  });

  it('source для невідомої події чи невідомого джерела — ігнорується (та сама мапа)', () => {
    expect(applyStreamEvent(chains, { type: 'source', eventId: 'нема', source: first })).toBe(chains);
    expect(applyStreamEvent(chains, { type: 'source', eventId, source: { ...first, id: 'нема-джерела' } })).toBe(chains);
  });

  it('chain: замінює ланцюжок цілком, додає новий', () => {
    const replaced = applyStreamEvent(chains, { type: 'chain', chain: { eventId, sources: [first] } });
    expect(replaced.get(eventId)!.sources).toEqual([first]);
    const added = applyStreamEvent(chains, { type: 'chain', chain: { eventId: 'нова', sources: [first] } });
    expect(added.get('нова')).toBeDefined();
    expect(added.size).toBe(chains.size + 1);
  });
});
