import { describe, expect, it } from 'vitest';
import { addSample, closeWindow, emptyWindow, windowOf, WINDOW_MS } from '../../src/domain/timekeeping/divergence';
import { createDivergenceMeter, parseEdgeNow, type TickTimers } from '../../src/timekeeping/divergence';
import type { AlarmInput, Clock } from '../../src/ports';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const noTimers: TickTimers = { every: () => {} };

function rig(start = 10 * WINDOW_MS) {
  let t = start;
  const real: Clock = { now: () => t };
  const alarms: AlarmInput[] = [];
  const meter = createDivergenceMeter({ real, alarm: { raise: (a) => void alarms.push(a) }, log: silent, timers: noTimers });
  return { meter, alarms, advance: (ms: number) => void (t += ms), at: () => t };
}

describe('divergence domain (AC-11, AC-13, AC-14)', () => {
  it('window is 60 s of real time', () => {
    expect(windowOf(0)).toBe(0);
    expect(windowOf(59_999)).toBe(0);
    expect(windowOf(60_000)).toBe(1);
  });

  it('AC-11: keeps the minimum of arrival minus edge mark (least delay)', () => {
    let acc = emptyWindow(1);
    for (const delay of [140, 90, 120, 200]) acc = addSample(acc, 1_000_000, 1_000_000 - delay);
    expect(acc.min).toBe(90);
    expect(closeWindow(acc, 0)).toEqual({ value: 90, level: 'ok', streak: 0 });
  });

  it('AC-13: 100 < |v| <= 250 is warn; 100 and 250 exact are on the good side of their lines', () => {
    expect(closeWindow({ window: 1, min: 100 }, 0).level).toBe('ok');
    expect(closeWindow({ window: 1, min: 101 }, 0).level).toBe('warn');
    expect(closeWindow({ window: 1, min: -250 }, 0).level).toBe('warn');
    expect(closeWindow({ window: 1, min: 250 }, 0).streak).toBe(0);
  });

  it('AC-12: page exactly when the bad streak reaches 3, once per streak; a good window resets', () => {
    const bad = { window: 1, min: 300 };
    const a = closeWindow(bad, 0);
    const b = closeWindow(bad, a.streak);
    const c = closeWindow(bad, b.streak);
    const d = closeWindow(bad, c.streak);
    expect([a.level, b.level, c.level, d.level]).toEqual(['warn', 'warn', 'page', 'warn']);
    expect(closeWindow({ window: 1, min: 120 }, b.streak).streak).toBe(0);
  });

  it('AC-14: an empty window is unknown, level ok, and resets the streak to 0', () => {
    expect(closeWindow(emptyWindow(1), 2)).toEqual({ value: 'unknown', level: 'ok', streak: 0 });
  });
});

describe('divergence meter (AC-10 ... AC-14)', () => {
  it('parseEdgeNow accepts only decimal digits that are a safe integer', () => {
    expect(parseEdgeNow('1700000000000')).toBe(1_700_000_000_000);
    for (const bad of [null, '', '-5', '1.5', '1e3', ' 12', '0x10', '99999999999999999999']) expect(parseEdgeNow(bad)).toBeUndefined();
  });

  it('AC-11: the closed window value is the minimum with simulated latency; unknown before it closes', () => {
    const { meter, advance, at } = rig();
    expect(meter.current().value).toBe('unknown');
    for (const delay of [140, 90, 120]) {
      meter.sample(at() - delay);
      advance(1_000);
    }
    expect(meter.current().value).toBe('unknown');
    advance(WINDOW_MS);
    meter.tick();
    expect(meter.current()).toMatchObject({ value: 90, level: 'ok' });
  });

  it('AC-13: a 150 ms window raises one log alarm edge-divergence-warn with ms and windows only', () => {
    const { meter, alarms, advance, at } = rig();
    meter.sample(at() - 150);
    advance(WINDOW_MS);
    meter.tick();
    expect(alarms).toEqual([{ level: 'log', source: 'clock', code: 'edge-divergence-warn', details: { ms: 150, windows: 0 } }]);
  });

  it('AC-12: three windows of 300 ms in a row raise exactly one page; a fourth does not repeat it', () => {
    const { meter, alarms, advance, at } = rig();
    for (let i = 0; i < 4; i++) {
      meter.sample(at() - 300);
      advance(WINDOW_MS);
      meter.tick();
    }
    const pages = alarms.filter((a) => a.level === 'page');
    expect(pages).toEqual([{ level: 'page', source: 'clock', code: 'edge-divergence', details: { ms: 300, windows: 3 } }]);
  });

  it('AC-14: a skipped (empty) window shows unknown and breaks the streak', () => {
    const { meter, alarms, advance, at } = rig();
    for (let i = 0; i < 2; i++) {
      meter.sample(at() - 300);
      advance(WINDOW_MS);
    }
    advance(3 * WINDOW_MS); // empty windows
    meter.tick();
    expect(meter.current().value).toBe('unknown');
    meter.sample(at() - 300);
    advance(WINDOW_MS);
    meter.tick();
    expect(alarms.some((a) => a.level === 'page')).toBe(false);
  });

  it('AC-14: real time only — the meter has no virtual-clock input', () => {
    const { meter, advance, at } = rig();
    meter.sample(at() - 80);
    advance(WINDOW_MS);
    meter.tick();
    expect(Object.keys(meter).sort()).toEqual(['current', 'sample', 'tick']);
    expect(meter.current().value).toBe(80);
  });
});
