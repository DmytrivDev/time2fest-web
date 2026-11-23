// @vitest-environment jsdom
/**
 * Обгортка YouTube IFrame API: політика автозапуску (лише один плеєр на сторінці) — вікна кімнати створюються з
 * `autoplay: 0` і міняють відео через `cue()` (cueVideoById, без запуску), `load()` — loadVideoById (запускає).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createYouTubePlayer } from '@/lib/player/youtubeApi';

interface Opts {
  playerVars: Record<string, number | string>;
  events: { onReady(): void };
}

let created: { opts: Opts; calls: string[] }[] = [];

beforeEach(() => {
  created = [];
  class FakePlayer {
    calls: string[] = [];
    constructor(_el: unknown, opts: Opts) {
      created.push({ opts, calls: this.calls });
    }
    loadVideoById = (v: unknown) => this.calls.push(`load:${typeof v === 'string' ? v : (v as { videoId: string }).videoId}`);
    cueVideoById = (v: unknown) => this.calls.push(`cue:${typeof v === 'string' ? v : (v as { videoId: string }).videoId}`);
    playVideo = () => this.calls.push('play');
    pauseVideo = () => this.calls.push('pause');
    mute = () => {};
    unMute = () => {};
    isMuted = () => true;
    getPlayerState = () => -1;
    getIframe = () => document.createElement('iframe');
    destroy = () => {};
  }
  (window as unknown as { YT: unknown }).YT = { Player: FakePlayer };
});

afterEach(() => {
  delete (window as { YT?: unknown }).YT;
});

describe('createYouTubePlayer: автозапуск', () => {
  it('за замовчуванням autoplay=1 (головний плеєр)', async () => {
    await createYouTubePlayer(document.createElement('div'), { videoId: 'a' });
    expect(created[0]!.opts.playerVars.autoplay).toBe(1);
  });

  it('autoplay:false → autoplay=0 (вікна кімнати 2–4)', async () => {
    await createYouTubePlayer(document.createElement('div'), { videoId: 'a', autoplay: false });
    expect(created[0]!.opts.playerVars.autoplay).toBe(0);
  });

  it('cue до готовності відкладається і виконується як cueVideoById, не loadVideoById', async () => {
    const h = await createYouTubePlayer(document.createElement('div'), { videoId: 'a', autoplay: false });
    h.cue('b');
    expect(created[0]!.calls).toEqual([]);
    created[0]!.opts.events.onReady();
    expect(created[0]!.calls).toEqual(['cue:b']);
    expect(h.videoId).toBe('b');
  });

  it('cue після готовності: cueVideoById; той самий id — нічого; load — loadVideoById', async () => {
    const h = await createYouTubePlayer(document.createElement('div'), { videoId: 'a', autoplay: false });
    created[0]!.opts.events.onReady();
    h.cue('a');
    h.cue('c');
    h.load('d');
    expect(created[0]!.calls).toEqual(['cue:c', 'load:d']);
  });

  it('play() до готовності нічого не робить', async () => {
    const h = await createYouTubePlayer(document.createElement('div'), { videoId: 'a', autoplay: false });
    h.play();
    expect(created[0]!.calls).toEqual([]);
  });
});

describe('createYouTubePlayer: вбудовування (AC-49)', () => {
  const embed = async (opts: Parameters<typeof createYouTubePlayer>[1]) => {
    const host = document.createElement('div');
    const mount = document.createElement('div');
    host.appendChild(mount);
    await createYouTubePlayer(mount, opts);
    return host.querySelector('iframe')!;
  };

  it('referrerpolicy strict-origin-when-cross-origin, без noreferrer, origin і enablejsapi у src', async () => {
    const iframe = await embed({ videoId: 'abc', origin: 'https://time2fest.com' });
    expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(iframe.getAttribute('rel') ?? '').not.toContain('noreferrer');
    const url = new URL(iframe.src);
    expect(url.pathname).toBe('/embed/abc');
    expect(url.searchParams.get('origin')).toBe('https://time2fest.com');
    expect(url.searchParams.get('enablejsapi')).toBe('1');
    expect(url.searchParams.get('playsinline')).toBe('1');
    expect(url.searchParams.get('mute')).toBe('1');
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(iframe.width).toBe('100%');
    expect(iframe.height).toBe('100%');
  });

  it('autoplay:false → autoplay=0 у src', async () => {
    const iframe = await embed({ videoId: 'abc', autoplay: false });
    expect(new URL(iframe.src).searchParams.get('autoplay')).toBe('0');
  });
});
