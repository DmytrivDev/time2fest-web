import { describe, expect, it } from 'vitest';
import { hasStreamNow, sortForStrip, withStatus } from '@/lib/live/eventCards';
import { buildDataset } from '@/lib/data/build';
import type { StreamsFile } from '@/lib/data/types';
import { isMainLive, knownStart, mainCardStream, mainLiveLine, mainSourceOf, zoneHasLive, type MainLiveLineInput } from '@/lib/engine/mainCelebration';
import { nowNextItems } from '@/lib/live/homeData';
import { selectSource } from '@/lib/player/chain';
import { MIN, miniSchedule, PARIS_MIDNIGHT, SEC, source } from '../fixtures/data';

const iso = (ms: number) => new Date(ms).toISOString();
/** Головне святкування Парижа: відомий початок за 9 хв до півночі. */
const MAIN_AT = PARIS_MIDNIGHT - 9 * MIN;
const mainKnown = source('src_paris_main', { kind: 'main', status: 'expected', isLive: false, startsAt: iso(MAIN_AT), order: 0 });
/** Той самий, але час початку невідомий (у даних немає `startsAt`). */
const mainUnknown = source('src_paris_main', { kind: 'main', status: 'expected', isLive: false, order: 0 });
const parisCam = source('src_paris_cam', { kind: 'webcam', order: 1, title: { uk: 'Париж · Ейфелева вежа' } });
const berlinCam = source('src_berlin_cam', { kind: 'webcam', order: 0, title: { uk: 'Берлін · Бранденбурзькі ворота' } });

function dataWith(chains: StreamsFile['chains']) {
  const { schedule, countries, streams } = miniSchedule();
  return buildDataset(schedule, countries, { ...streams, chains: [...streams.chains, ...chains] });
}

describe('головне святкування: час початку (2026-11-13)', () => {
  it('відомий і ще попереду — є час (і відлік)', () => {
    expect(knownStart(mainKnown, MAIN_AT - 5 * MIN)).toBe(MAIN_AT);
  });

  it('невідомий (немає в даних) — ні часу, ні відліку', () => {
    expect(knownStart(mainUnknown, MAIN_AT - 5 * MIN)).toBeNull();
  });

  it('уже минув — теж без часу й без числа', () => {
    expect(knownStart(mainKnown, MAIN_AT + SEC)).toBeNull();
  });

  it('невідомий початок: «очікується», доки дані не скажуть «наживо»; плеєр його не пробує', () => {
    expect(isMainLive(mainUnknown, PARIS_MIDNIGHT + 10 * MIN)).toBe(false);
    expect(isMainLive({ ...mainUnknown, status: 'live', isLive: true }, PARIS_MIDNIGHT)).toBe(true);
    const ctx = { slot: 'main' as const, eventId: 'evt_paris_2027', failed: [], facebookConsent: false, now: PARIS_MIDNIGHT };
    expect(selectSource({ ...ctx, sources: [mainUnknown] })).toEqual({ kind: 'countdown-scene' });
  });

  it('відомий початок настав — наживо сам (відео вмикається саме)', () => {
    expect(isMainLive(mainKnown, MAIN_AT - SEC)).toBe(false);
    expect(isMainLive(mainKnown, MAIN_AT)).toBe(true);
  });
});

describe('кнопка «Дивитися, що вже йде»: чи йде щось у поясі', () => {
  it('вебкамера поясу наживо — так; лише головне, що ще не почалось, — ні', () => {
    const live = dataWith([{ eventId: 'evt_berlin_2027', sources: [berlinCam] }, { eventId: 'evt_paris_2027', sources: [mainKnown] }]);
    expect(zoneHasLive(live, PARIS_MIDNIGHT, MAIN_AT - MIN)).toBe(true);
    const none = dataWith([{ eventId: 'evt_paris_2027', sources: [mainKnown] }]);
    expect(zoneHasLive(none, PARIS_MIDNIGHT, MAIN_AT - MIN)).toBe(false);
  });

  it('трансляції іншого поясу не рахуються', () => {
    // Лондон (UTC+0) наживо, а північ — паризька.
    const data = dataWith([{ eventId: 'evt_paris_2027', sources: [mainKnown] }]);
    expect(data.chainsByEventId.get('evt_london_2027')?.sources.length).toBeGreaterThan(0);
    expect(zoneHasLive(data, PARIS_MIDNIGHT, MAIN_AT - MIN)).toBe(false);
  });
});

describe('«Зараз і далі»: картка головного святкування', () => {
  const data = dataWith([{ eventId: 'evt_paris_2027', sources: [mainKnown, parisCam] }, { eventId: 'evt_berlin_2027', sources: [berlinCam] }]);
  const now = MAIN_AT - 5 * MIN;

  it('ще не почалось — картка є, перша, «очікується», «Головне святкування», мініатюра головного', () => {
    const items = nowNextItems(data, now, [], { liveOthers: true, mainCards: true });
    const paris = items.find((i) => i.id === 'evt_paris_2027')!;
    expect(paris).toMatchObject({ main: true, stream: 'expected', celebrationType: 'main' });
    const sameMidnight = sortForStrip(withStatus(now, items), 'evt_paris_2027').filter((i) => i.midnightMs === PARIS_MIDNIGHT);
    expect(sameMidnight[0]!.id).toBe('evt_paris_2027');
    expect(sameMidnight.map((i) => i.id)).toContain('evt_berlin_2027');
  });

  it('фільтр «З трансляціями» її лишає', () => {
    const items = nowNextItems(data, now, [], { liveOthers: true, mainCards: true });
    expect(items.filter(hasStreamNow).some((i) => i.id === 'evt_paris_2027')).toBe(true);
  });

  it('подія з графіка того самого часу не випереджає головне святкування', () => {
    const items = nowNextItems(data, now, ['evt_berlin_2027'], { liveOthers: true, mainCards: true });
    const first = sortForStrip(withStatus(now, items), 'evt_paris_2027').find((i) => i.midnightMs === PARIS_MIDNIGHT);
    expect(first!.id).toBe('evt_paris_2027');
  });

  it('почалось — «наживо»; без `mainCards` (режим вечірки) картка як раніше — за найкращим джерелом', () => {
    expect(mainCardStream(mainKnown, MAIN_AT)).toBe('live');
    const tv = nowNextItems(data, now, []).find((i) => i.id === 'evt_paris_2027')!;
    expect(tv.main).toBeUndefined();
    expect(tv.stream).toBe('live');
  });

  it('статус «none» головного (не вбудовується) — теж «очікується», а не зникає', () => {
    expect(mainCardStream({ ...mainKnown, embeddable: false, startsAt: undefined, status: 'live' }, now)).toBe('expected');
  });

  it('головне джерело — `kind: main`', () => {
    expect(mainSourceOf(data.chainsByEventId.get('evt_paris_2027'))?.id).toBe('src_paris_main');
    expect(mainSourceOf(data.chainsByEventId.get('evt_berlin_2027'))).toBeNull();
  });
});

describe('рядок «Головне святкування почалось · Перемкнути»', () => {
  const live = { ...mainKnown, startsAt: iso(MAIN_AT) };
  const base: MainLiveLineInput = {
    now: MAIN_AT + MIN,
    main: { eventId: 'evt_paris_2027', source: live },
    midnightMs: PARIS_MIDNIGHT,
    playing: { eventId: 'evt_berlin_2027', sourceId: 'src_berlin_cam', midnightMs: PARIS_MIDNIGHT },
    manual: true,
    stampHint: false,
    handoverAt: PARIS_MIDNIGHT + 15 * MIN,
  };

  it('людина сама обрала іншу трансляцію цього поясу, головне вже йде — рядок є', () => {
    expect(mainLiveLine(base)).toBe(true);
  });

  it('вебкамера того самого міста (інше джерело тієї самої події) — теж', () => {
    expect(mainLiveLine({ ...base, playing: { eventId: 'evt_paris_2027', sourceId: 'src_paris_cam', midnightMs: PARIS_MIDNIGHT } })).toBe(true);
  });

  it('головне ще не почалось — рядка немає', () => {
    expect(mainLiveLine({ ...base, now: MAIN_AT - SEC })).toBe(false);
  });

  it('невідомий початок: рядок — лише коли дані кажуть «наживо»', () => {
    const unknown = { ...base, main: { eventId: 'evt_paris_2027', source: mainUnknown } };
    expect(mainLiveLine(unknown)).toBe(false);
    expect(mainLiveLine({ ...unknown, main: { eventId: 'evt_paris_2027', source: { ...mainUnknown, status: 'live', isLive: true } } })).toBe(true);
  });

  it('грає саме головне (перемкнули) — рядок ховається', () => {
    expect(mainLiveLine({ ...base, playing: { eventId: 'evt_paris_2027', sourceId: 'src_paris_main', midnightMs: PARIS_MIDNIGHT } })).toBe(false);
  });

  it('не вибір людини (плеєр відступив на запасне джерело) — рядка немає', () => {
    expect(mainLiveLine({ ...base, manual: false })).toBe(false);
  });

  it('трансляція іншого поясу — рядка немає', () => {
    expect(mainLiveLine({ ...base, playing: { eventId: 'evt_london_2027', sourceId: 'src_london_1', midnightMs: PARIS_MIDNIGHT + 60 * MIN } })).toBe(false);
  });

  it('останні 60 с до півночі рядок віддає підказці про штамп', () => {
    expect(mainLiveLine({ ...base, now: PARIS_MIDNIGHT - 30 * SEC, stampHint: true })).toBe(false);
    expect(mainLiveLine({ ...base, now: PARIS_MIDNIGHT - 30 * SEC, stampHint: false })).toBe(true);
  });

  it('після передачі ефіру наступному поясу — рядка немає', () => {
    expect(mainLiveLine({ ...base, now: PARIS_MIDNIGHT + 15 * MIN - SEC })).toBe(true);
    expect(mainLiveLine({ ...base, now: PARIS_MIDNIGHT + 15 * MIN })).toBe(false);
  });

  it('без головного святкування в події — рядка немає', () => {
    expect(mainLiveLine({ ...base, main: null })).toBe(false);
  });
});
