import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachMachinePersistence,
  parseMachineParams,
  readSavedMachine,
  resolveMachineStart,
} from '@/lib/time/params';
import {
  DEFAULT_START_ISO,
  DEFAULT_START_MS,
  MACHINE_STORAGE_KEY,
  sanitizeSpeed,
  TimeMachine,
} from '@/lib/time/timeMachine';

function perfClock(start = 0) {
  const c = { p: start };
  return { c, perfNow: () => c.p };
}

describe('TimeMachine', () => {
  it('virtualNow = anchorVirtual + (performance.now() − anchorPerf) × speed', () => {
    const { c, perfNow } = perfClock(500);
    const m = new TimeMachine({ at: 1_000_000, speed: 10, perfNow });
    c.p += 3_000;
    expect(m.now()).toBe(1_000_000 + 3_000 * 10);
    expect(m.status).toBe('machine');
  });

  it('speed = 0 заморожує час', () => {
    const { c, perfNow } = perfClock();
    const m = new TimeMachine({ at: 42, speed: 0, perfNow });
    c.p += 60_000;
    expect(m.now()).toBe(42);
  });

  it('set перезаписує обидва якорі; advance стрибає вперед; підписники дізнаються', () => {
    const { c, perfNow } = perfClock();
    const m = new TimeMachine({ at: 0, perfNow });
    const spy = vi.fn();
    m.subscribe(spy);
    c.p = 1_000;
    m.set({ at: 5_000, speed: 2 });
    c.p = 1_500;
    expect(m.now()).toBe(6_000);
    m.advance(60_000);
    expect(m.now()).toBe(66_000);
    m.advance(-5);
    expect(m.now()).toBe(66_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('speed', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['10', 10],
    ['600', 600],
    ['601', 1],
    ['-1', 1],
    ['abc', 1],
    ['Infinity', 1],
    ['', 1],
  ])('speed=%s → %d', (raw, expected) => {
    expect(sanitizeSpeed(raw)).toBe(expected);
    expect(parseMachineParams(`?speed=${raw}`).speed).toBe(expected);
  });
});

describe('параметри адреси', () => {
  it('t зі зсувом або Z', () => {
    expect(parseMachineParams('?t=2027-01-01T01:59:30%2B02:00').at).toBe(Date.parse('2026-12-31T23:59:30Z'));
    expect(parseMachineParams('?t=2026-12-31T23:59:30Z').at).toBe(Date.parse('2026-12-31T23:59:30Z'));
    // незакодований «+» приходить пробілом
    expect(parseMachineParams('?t=2027-01-01T01:59:30+02:00').at).toBe(Date.parse('2026-12-31T23:59:30Z'));
  });

  it('непарсований t ігнорується з попередженням «Невірний t»', () => {
    for (const bad of ['?t=вчора', '?t=2027-01-01T01:59:30', '?t=2027-13-45T99:00:00Z']) {
      const p = parseMachineParams(bad);
      expect(p.at).toBeUndefined();
      expect(p.warnings).toContain('Невірний t');
    }
    const s = resolveMachineStart({ search: '?t=nonsense', isTest: true, storage: sessionStorage });
    expect(s!.at).toBe(DEFAULT_START_MS);
    expect(s!.warnings).toContain('Невірний t');
  });

  it('panel=1', () => {
    expect(parseMachineParams('?panel=1').panel).toBe(true);
    expect(parseMachineParams('?panel=0').panel).toBe(false);
  });
});

describe('стартовий момент', () => {
  afterEach(() => sessionStorage.clear());

  it('за замовчуванням 2027-01-01T01:38:00+02:00', () => {
    expect(DEFAULT_START_ISO).toBe('2027-01-01T01:38:00+02:00');
    expect(DEFAULT_START_MS).toBe(Date.parse('2026-12-31T23:38:00Z'));
    const s = resolveMachineStart({ search: '', isTest: true, storage: sessionStorage });
    expect(s).toMatchObject({ at: DEFAULT_START_MS, speed: 1, origin: 'default' });
  });

  it('збережене доганяє: at + (Date.now() − savedAtMs) × speed', () => {
    sessionStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ at: 1_000, speed: 10, savedAtMs: 50_000 }));
    const s = resolveMachineStart({ search: '', isTest: true, storage: sessionStorage, dateNow: () => 52_000 });
    expect(s).toMatchObject({ at: 1_000 + 2_000 * 10, speed: 10, origin: 'saved' });
  });

  it('явний t перемагає збережене', () => {
    sessionStorage.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ at: 1_000, speed: 10, savedAtMs: 0 }));
    const s = resolveMachineStart({ search: '?t=2026-12-31T23:59:30Z', isTest: true, storage: sessionStorage });
    expect(s).toMatchObject({ at: Date.parse('2026-12-31T23:59:30Z'), speed: 1, origin: 'param' });
  });

  it('у робочій збірці t, speed, panel ігноруються', () => {
    expect(resolveMachineStart({ search: '?t=2026-12-31T23:59:30Z&speed=10&panel=1', isTest: false })).toBeNull();
  });

  it('пошкоджене збережене значення не ламає старт', () => {
    sessionStorage.setItem(MACHINE_STORAGE_KEY, '{oops');
    expect(readSavedMachine(sessionStorage)).toBeNull();
    expect(resolveMachineStart({ search: '', isTest: true, storage: sessionStorage })!.origin).toBe('default');
  });
});

describe('збереження й адреса', () => {
  it('зміни пишуться в sessionStorage { at, speed, savedAtMs } і в адресу через replaceState', () => {
    const { c, perfNow } = perfClock();
    const m = new TimeMachine({ at: Date.parse('2026-12-31T23:00:00Z'), perfNow });
    const replace = vi.spyOn(window.history, 'replaceState');
    const detach = attachMachinePersistence(m, { storage: sessionStorage, win: window, dateNow: () => 777 });
    c.p = 0;
    m.set({ at: Date.parse('2026-12-31T23:59:30Z'), speed: 10 });
    const saved = JSON.parse(sessionStorage.getItem(MACHINE_STORAGE_KEY)!);
    expect(saved).toEqual({ at: Date.parse('2026-12-31T23:59:30Z'), speed: 10, savedAtMs: 777 });
    expect(replace).toHaveBeenCalled();
    const url = new URL(window.location.href);
    expect(url.searchParams.get('t')).toBe('2026-12-31T23:59:30Z');
    expect(url.searchParams.get('speed')).toBe('10');
    detach();
    replace.mockRestore();
    window.history.replaceState(null, '', '/');
  });
});

describe('createAppTimeSource', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/env');
  });

  it('робоча збірка: серверний TimeSource, параметри не діють', async () => {
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: false, IS_DEMO_BUILD: false }));
    window.history.replaceState(null, '', '/?t=2026-12-31T23:59:30Z&speed=10');
    const { createAppTimeSource } = await import('@/lib/time/params');
    const app = createAppTimeSource();
    expect(app.machine).toBeNull();
    expect(app.source.status).not.toBe('machine');
    window.history.replaceState(null, '', '/');
  });

  it('тестова збірка: машина часу з параметра t', async () => {
    vi.doMock('@/lib/env', () => ({ IS_TEST_BUILD: true, IS_DEMO_BUILD: false }));
    window.history.replaceState(null, '', '/?t=2026-12-31T23:59:30Z&speed=0');
    const { createAppTimeSource } = await import('@/lib/time/params');
    const app = createAppTimeSource();
    expect(app.source.status).toBe('machine');
    expect(app.source.now()).toBe(Date.parse('2026-12-31T23:59:30Z'));
    window.history.replaceState(null, '', '/');
  });
});
