/**
 * Stream sources domain rules (SPEC-21a AC-8, AC-9, AC-11, AC-15, AC-17, AC-23 … AC-29, AC-31, AC-46 rule halves),
 * without a database or a network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANDIDATE_STATES, type CandidateState } from '@time2fest/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  activeSourceCount,
  agentProposalAllowed,
  candidateOnSourceStatus,
  capForAgent,
  chainFull,
  checkIsFresh,
  cheapVerdict,
  defaultEvent,
  mergeOrigin,
  retentionPlan,
  transition,
  type CandidateActor,
  type CheapCheckVideo,
} from '../../src/domain/live/candidates';
import { canWatchMore, playlistDue, refreshDue, searchDue, type WatchChannel } from '../../src/domain/live/channels';
import { LIVE_DEFAULTS, parseLiveConfig, type LiveConfig } from '../../src/domain/live/config';
import { allow, allowedClasses, chargeCalls, counterOf, type CallerContext, type QuotaState } from '../../src/domain/live/quota';

const cfg = LIVE_DEFAULTS;
const fake: CallerContext = { envClass: 'production', adapter: 'fake' };
const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-12-31T12:00:00Z');
const withCfg = (over: Partial<LiveConfig>): LiveConfig => ({ ...cfg, ...over });

describe('candidate transitions (AC-8)', () => {
  // The AC-8 table written out pair by pair, independently of the module's table.
  const ALLOWED = new Set<string>([
    ...['new', 'proposed', 'rejected'].map((to) => `null>${to}:server`),
    'new>proposed:agent',
    'new>proposed:owner',
    ...['new', 'proposed'].flatMap((f) => ['approved', 'rejected'].map((to) => `${f}>${to}:owner`)),
    'new>rejected:server',
    'proposed>rejected:server',
    'approved>active:server',
    'approved>dead:server',
    'active>dead:server',
    'rejected>new:owner',
    ...['approved', 'active', 'dead', 'rejected'].map((f) => `${f}>archive:server`),
  ]);
  const froms: (CandidateState | null)[] = [null, ...CANDIDATE_STATES];
  const actors: CandidateActor[] = ['owner', 'agent', 'server'];
  const pairs = froms.flatMap((from) => CANDIDATE_STATES.flatMap((to) => actors.map((actor) => [from, to, actor] as const)));

  it('covers every from × to × actor', () => {
    expect(pairs).toHaveLength(8 * 7 * 3);
  });
  it.each(pairs)('%s → %s by %s', (from, to, actor) => {
    const expected = ALLOWED.has(`${from}>${to}:${actor}`);
    expect(transition(from, to, actor)).toEqual(expected ? { ok: true } : { ok: false, code: 'invalid-state' });
  });
  it('a journal revert returns any state but archive to the recorded previous one, nothing else', () => {
    for (const from of CANDIDATE_STATES) {
      for (const prev of CANDIDATE_STATES) {
        const ok = from !== 'archive' && prev !== from;
        expect(transition(from, prev, 'revert', prev).ok, `${from} → ${prev}`).toBe(ok);
      }
    }
    expect(transition('approved', 'new', 'revert', 'proposed').ok).toBe(false);
    expect(transition('approved', 'proposed', 'revert').ok).toBe(false);
    expect(transition(null, 'new', 'revert', 'new').ok).toBe(false);
  });
});

describe('cheap check verdict (AC-3, AC-11)', () => {
  const BL = 'UC' + 'b'.repeat(22);
  const fit: CheapCheckVideo = { channelId: 'UC' + 'a'.repeat(22), privacyStatus: 'public', embeddable: true, liveBroadcastContent: 'upcoming' };
  const bl = new Set([BL]);
  it('fit: new without an event, proposed with one; live passes too', () => {
    expect(cheapVerdict(fit, bl, false)).toEqual({ state: 'new' });
    expect(cheapVerdict(fit, bl, true)).toEqual({ state: 'proposed' });
    expect(cheapVerdict({ ...fit, liveBroadcastContent: 'live' }, bl, false)).toEqual({ state: 'new' });
  });
  it.each([
    ['not-found', null],
    ['blacklisted', { ...fit, channelId: BL, privacyStatus: 'private' }],
    ['private', { ...fit, privacyStatus: 'unlisted', embeddable: false }],
    ['not-embeddable', { ...fit, embeddable: false, liveBroadcastContent: 'none' }],
    ['not-live', { ...fit, liveBroadcastContent: 'none' }],
  ] as const)('%s (in this order)', (reason, video) => {
    expect(cheapVerdict(video, bl, true)).toEqual({ state: 'rejected', reason });
  });
});

describe('duplicates and the agent cap (AC-9, AC-31)', () => {
  it('a new origin joins, the state stays — rejected stays rejected', () => {
    expect(mergeOrigin({ foundBy: ['playlist'], state: 'new' }, 'agent')).toEqual({ foundBy: ['agent', 'playlist'], state: 'new', changed: true });
    expect(mergeOrigin({ foundBy: ['agent'], state: 'rejected' }, 'agent')).toEqual({ foundBy: ['agent'], state: 'rejected', changed: false });
  });
  it('the agent never goes above proposed', () => {
    for (const s of CANDIDATE_STATES) expect(['new', 'proposed', 'rejected']).toContain(capForAgent(s));
    expect(capForAgent('approved')).toBe('proposed');
  });
  it('agent daily proposals stop at the configured count', () => {
    expect(agentProposalAllowed(cfg.agent.proposalsPerDay - 1, cfg)).toBe(true);
    expect(agentProposalAllowed(cfg.agent.proposalsPerDay, cfg)).toBe(false);
  });
});

describe('default event (AC-15)', () => {
  const events = [
    { eventId: 'gb-london', zoneId: 'utc+0000', moment: at('2027-01-01T00:00:00Z'), hidden: false },
    { eventId: 'fr-paris', zoneId: 'utc+0100', moment: at('2026-12-31T23:00:00Z'), hidden: false },
  ];
  it('23:58 UTC and a utc+0000 channel → that zone event', () => {
    expect(defaultEvent(at('2026-12-31T23:58:00Z'), ['utc+0000'], events, cfg)).toBe('gb-london');
  });
  it('nothing within ±3 h, or no zone match → empty', () => {
    expect(defaultEvent(at('2027-01-01T03:00:01Z'), ['utc+0000'], events, cfg)).toBeNull();
    expect(defaultEvent(at('2026-12-31T23:58:00Z'), ['utc+0530'], events, cfg)).toBeNull();
    expect(defaultEvent(null, ['utc+0000'], events, cfg)).toBeNull();
  });
  it('the nearest of the channel zones wins; hidden events are skipped', () => {
    expect(defaultEvent(at('2026-12-31T23:20:00Z'), ['utc+0000', 'utc+0100'], events, cfg)).toBe('fr-paris');
    expect(defaultEvent(at('2026-12-31T23:20:00Z'), ['utc+0000', 'utc+0100'], [events[0]!, { ...events[1]!, hidden: true }], cfg)).toBe('gb-london');
  });
});

describe('chain ceiling, freshness and source status (AC-10, AC-17, AC-23)', () => {
  const s = (over: object = {}) => ({ videoId: 'aaaaaaaaaaa', dead: false, hidden: false, ...over });
  it('counts sources with a videoId, not dead, not hidden', () => {
    expect(activeSourceCount([s(), s({ dead: true }), s({ hidden: true }), s({ override: 'hidden' }), s({ videoId: null }), s()])).toBe(2);
  });
  it('three active → full; hiding one frees a place', () => {
    expect(chainFull([s(), s(), s()], cfg)).toBe(true);
    expect(chainFull([s(), s(), s({ hidden: true })], cfg)).toBe(false);
  });
  it('a check of 5 min is fresh, 6 min is not', () => {
    expect(checkIsFresh(NOW - 5 * MIN, NOW, cfg)).toBe(true);
    expect(checkIsFresh(NOW - 6 * MIN, NOW, cfg)).toBe(false);
    expect(checkIsFresh(null, NOW, cfg)).toBe(false);
  });
  it('approved → active on live, approved/active → dead', () => {
    expect(candidateOnSourceStatus('approved', true, false)).toBe('active');
    expect(candidateOnSourceStatus('approved', false, true)).toBe('dead');
    expect(candidateOnSourceStatus('active', false, true)).toBe('dead');
    expect(candidateOnSourceStatus('active', true, false)).toBeNull();
    expect(candidateOnSourceStatus('proposed', true, false)).toBeNull();
  });
});

describe('retention plan (AC-46)', () => {
  const c = (videoId: string, state: CandidateState, ytFetchedAt: number | null, stateChangedAt = NOW) => ({ videoId, state, ytFetchedAt, stateChangedAt });
  it('+31 days: live-queue fields refreshed, decided ones stripped and archived', () => {
    const now = NOW + 31 * DAY;
    const plan = retentionPlan(
      [c('new1', 'new', NOW), c('fresh', 'proposed', now - DAY), c('appr', 'approved', NOW, now - DAY), c('rej', 'rejected', NOW), c('dead', 'dead', null), c('arch', 'archive', NOW)],
      now,
      cfg,
    );
    expect(plan.refresh).toEqual(['new1', 'appr']);
    expect(plan.archive).toEqual(['rej', 'dead']);
    expect(plan.strip).toEqual(['rej', 'arch']);
  });
});

describe('channel watch schedule (AC-6, AC-26 … AC-28)', () => {
  const moment = at('2027-01-01T00:00:00Z');
  const ch = (over: Partial<WatchChannel> = {}): WatchChannel => ({ state: 'watched', uploadsPlaylistId: 'UUx', uploadsFetchedAt: NOW, lastPlaylistAt: null, ...over });

  function reads(from: number, to: number, lastPlaylistAt: number | null, c: LiveConfig = cfg): number {
    let last = lastPlaylistAt;
    let n = 0;
    for (let now = from; now < to; now += c.watchPassMs) {
      if (playlistDue(ch({ lastPlaylistAt: last }), [moment], now, c)) {
        n += 1;
        last = now;
      }
    }
    return n;
  }
  it('6 h outside the near window → 1 read; −6 h … +1 h around midnight → 7 reads', () => {
    const t0 = moment - 2 * DAY;
    expect(reads(t0 + cfg.watchPassMs, t0 + 6 * HOUR + cfg.watchPassMs, t0)).toBe(1);
    expect(reads(moment - 6 * HOUR, moment + HOUR, moment - 7 * HOUR)).toBe(7);
  });
  it('off, proposed, blacklisted or without an uploads playlist → no read', () => {
    for (const over of [{ state: 'off' as const }, { state: 'proposed' as const }, { blacklisted: true }, { uploadsPlaylistId: null }]) {
      expect(playlistDue(ch(over), [moment], NOW, cfg)).toBe(false);
    }
  });
  it('uploads refresh after 30 days or when unknown', () => {
    expect(refreshDue(ch(), NOW + 30 * DAY - 1, cfg)).toBe(false);
    expect(refreshDue(ch(), NOW + 30 * DAY, cfg)).toBe(true);
    expect(refreshDue(ch({ uploadsPlaylistId: null }), NOW, cfg)).toBe(true);
  });
  it('one search in [−12 h; −2 h], none once searched or with a live candidate', () => {
    const zm = [{ eventId: 'gb-london', moment }];
    expect(searchDue(ch(), zm, () => false, moment - 12 * HOUR - 1, cfg)).toBeNull();
    expect(searchDue(ch(), zm, () => false, moment - 12 * HOUR, cfg)).toEqual(zm[0]);
    expect(searchDue(ch(), zm, () => false, moment - 2 * HOUR, cfg)).toEqual(zm[0]);
    expect(searchDue(ch(), zm, () => false, moment - 2 * HOUR + 1, cfg)).toBeNull();
    expect(searchDue({ ...ch(), lastSearchAt: moment - 10 * HOUR }, zm, () => false, moment - 5 * HOUR, cfg)).toBeNull();
    expect(searchDue({ ...ch(), lastSearchAt: moment - 2 * DAY }, zm, () => false, moment - 5 * HOUR, cfg)).toEqual(zm[0]);
    expect(searchDue(ch(), zm, (id) => id === 'gb-london', moment - 5 * HOUR, cfg)).toBeNull();
  });
  it('the 101st watched channel is refused', () => {
    expect(canWatchMore(cfg.maxWatchedChannels - 1, cfg)).toBe(true);
    expect(canWatchMore(cfg.maxWatchedChannels, cfg)).toBe(false);
  });
});

describe('quota classes of the wave (AC-25, AC-29)', () => {
  it('each class is allowed first, then charged to its bucket and its own counter', () => {
    let s: QuotaState = {};
    for (const cls of ['candidates', 'playlists', 'search'] as const) {
      expect(allow(s, cls, NOW, cfg, fake).ok, cls).toBe(true);
      s = chargeCalls(s, cls, 1, NOW, cfg).state;
    }
    expect(counterOf(s, 'queries', NOW, cfg).used).toBe(2);
    expect(counterOf(s, 'candidates', NOW, cfg).used).toBe(1);
    expect(counterOf(s, 'playlists', NOW, cfg).used).toBe(1);
    expect(counterOf(s, 'search', NOW, cfg).used).toBe(1);
  });
  it('with 999 units left only statuses run', () => {
    const s: QuotaState = { queries: { ...counterOf({}, 'queries', NOW, cfg), used: cfg.buckets.queries.perDay - 999 } };
    expect(allowedClasses(s, NOW, cfg, fake)).toEqual(['statuses']);
  });
  it('search counter at 100 → the 101st is skipped without touching the port; playlists still run', () => {
    const s: QuotaState = { search: { ...counterOf({}, 'search', NOW, cfg), used: cfg.buckets.search.perDay } };
    const port = vi.fn();
    const gated = (cls: 'search' | 'playlists') => {
      if (allow(s, cls, NOW, cfg, fake).ok) port(cls);
    };
    gated('search');
    expect(port).not.toHaveBeenCalled();
    expect(allow(s, 'search', NOW, cfg, fake)).toEqual({ ok: false, reason: 'quota-exhausted' });
    gated('playlists');
    expect(port).toHaveBeenCalledWith('playlists');
  });
});

describe('every SPEC-21a number comes from the configuration (AC-24)', () => {
  const moment = at('2027-01-01T00:00:00Z');
  const w: WatchChannel = { state: 'watched', uploadsPlaylistId: 'UUx', uploadsFetchedAt: NOW };
  const three = Array.from({ length: 3 }, () => ({ videoId: 'aaaaaaaaaaa' }));
  const usedOf = (key: 'candidates' | 'playlists', n: number): QuotaState => ({ [key]: { ...counterOf({}, key, NOW, cfg), used: n } });
  const zm = [{ eventId: 'e', moment }];
  // Each case: the outcome under the defaults, and under the changed parameter (must differ).
  const cases: Array<[string, (c: LiveConfig) => unknown, LiveConfig]> = [
    ['maxSourcesPerEvent', (c) => chainFull(three, c), withCfg({ maxSourcesPerEvent: 4 })],
    ['maxWatchedChannels', (c) => canWatchMore(5, c), withCfg({ maxWatchedChannels: 5 })],
    ['classCeilings.candidates', (c) => allow(usedOf('candidates', 10), 'candidates', NOW, c, fake).ok, withCfg({ classCeilings: { ...cfg.classCeilings, candidates: 10 } })],
    ['classCeilings.playlists', (c) => allow(usedOf('playlists', 10), 'playlists', NOW, c, fake).ok, withCfg({ classCeilings: { ...cfg.classCeilings, playlists: 10 } })],
    ['playlistEveryMs', (c) => playlistDue({ ...w, lastPlaylistAt: NOW - 2 * HOUR }, [], NOW, c), withCfg({ playlistEveryMs: HOUR })],
    ['playlistNearEveryMs', (c) => playlistDue({ ...w, lastPlaylistAt: moment - 40 * MIN }, [moment], moment, c), withCfg({ playlistNearEveryMs: 30 * MIN })],
    ['playlistNearBeforeMs', (c) => playlistDue({ ...w, lastPlaylistAt: moment - 9 * HOUR }, [moment], moment - 8 * HOUR, c), withCfg({ playlistNearBeforeMs: 9 * HOUR })],
    ['playlistNearAfterMs', (c) => playlistDue({ ...w, lastPlaylistAt: moment }, [moment], moment + 2 * HOUR, c), withCfg({ playlistNearAfterMs: 3 * HOUR })],
    ['channelRefreshMs', (c) => refreshDue(w, NOW + 2 * DAY, c), withCfg({ channelRefreshMs: DAY })],
    ['searchFromMs', (c) => searchDue(w, zm, () => false, moment - 13 * HOUR, c) !== null, withCfg({ searchFromMs: 14 * HOUR })],
    ['searchToMs', (c) => searchDue(w, zm, () => false, moment - HOUR, c) !== null, withCfg({ searchToMs: 30 * MIN })],
    ['candidateFreshMs', (c) => checkIsFresh(NOW - 6 * MIN, NOW, c), withCfg({ candidateFreshMs: 10 * MIN })],
    ['defaultEventToleranceMs', (c) => defaultEvent(moment + 4 * HOUR, ['z'], [{ eventId: 'e', zoneId: 'z', moment, hidden: false }], c), withCfg({ defaultEventToleranceMs: 5 * HOUR })],
    ['candidateRefreshMs', (c) => retentionPlan([{ videoId: 'v', state: 'new', ytFetchedAt: NOW, stateChangedAt: NOW }], NOW + 2 * DAY, c).refresh.length, withCfg({ candidateRefreshMs: DAY })],
    ['candidateArchiveMs', (c) => retentionPlan([{ videoId: 'v', state: 'rejected', ytFetchedAt: null, stateChangedAt: NOW }], NOW + 2 * DAY, c).archive.length, withCfg({ candidateArchiveMs: DAY })],
    ['agent.proposalsPerDay', (c) => agentProposalAllowed(10, c), withCfg({ agent: { proposalsPerDay: 10 } })],
  ];
  it.each(cases)('%s changes the outcome', (_key, run, changed) => {
    expect(run(changed)).not.toEqual(run(cfg));
  });

  it('T2F_LIVE_CONFIG overrides the new keys strictly', () => {
    const r = parseLiveConfig(JSON.stringify({ maxSourcesPerEvent: 4, classCeilings: { candidates: 10 }, agent: { proposalsPerDay: 5 } }));
    expect(r.ok && r.config.maxSourcesPerEvent).toBe(4);
    expect(r.ok && r.config.classCeilings).toEqual({ candidates: 10, playlists: cfg.classCeilings.playlists });
    expect(r.ok && r.config.agent.proposalsPerDay).toBe(5);
    expect(parseLiveConfig(JSON.stringify({ classCeilings: { search: 1 } })).ok).toBe(false);
    expect(parseLiveConfig(JSON.stringify({ candidateRefreshMs: 31 * DAY })).ok).toBe(false);
    expect(parseLiveConfig(JSON.stringify({ searchToMs: 13 * HOUR })).ok).toBe(false);
  });

  it('no ceiling literal in the SPEC-21a modules (code, comments stripped)', () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const files = ['domain/live/candidates.ts', 'domain/live/channels.ts', 'live/sources.ts', 'live/watch.ts'].filter((f) => existsSync(root + f));
    expect(files.length).toBeGreaterThanOrEqual(2);
    const hits: string[] = [];
    for (const f of files) {
      const code = readFileSync(root + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const m of code.matchAll(/(?<![\w.])\d[\d_]*(?![\w.])/g)) if (['300', '1000', '100', '3', '50', '500'].includes(m[0].replaceAll('_', ''))) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
