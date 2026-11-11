'use client';

/**
 * Звук сцени відліку (власник 2026-11-11): 12 ударів курантів в останні 12 с до півночі й салют опівночі.
 * Записи (власник 2026-11-11: синтез звучав штучно) — CC0 з BigSoundBank (Joseph Sardin): удар дзвона на дзвіниці
 * в Ла-Лупі (№ 3446) і міський салют (№ 2672, 40 с: фінальний залп, далі рівний салют) — `public/sounds/`.
 * Поки записи не завантажились або недоступні — синтез у Web Audio: обертони великого дзвона, вибух із «бумом» і тріском.
 *
 * Звук сцени вмикає та сама кнопка «Увімкнути звук» (відео немає — вона керує сценою). Якщо людина вже вмикала звук
 * у цьому сеансі (дивилась трансляцію й перемкнулась на відлік), звук сцени ввімкнений одразу.
 */
import { useSyncExternalStore } from 'react';
import { readSoundFlag, writeSoundFlag } from '@/lib/player/PlayerProvider';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
/** `null` — ще не читали прапор сеансу. */
let on: boolean | null = null;
const listeners = new Set<() => void>();
const files: Record<'bell' | 'fireworks', AudioBuffer | null> = { bell: null, fireworks: null };
let loading: Promise<void> | null = null;
/** Салют, що грає зараз (запис), — щоб зупинити, коли сцена зникла. */
let bed: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

/** Завантажити записи (раз на сторінку); без звуку сцени не вантажимо. */
export function preloadSceneSounds() {
  const a = audio();
  if (!a || loading) return;
  const load = async (name: 'bell' | 'fireworks') => {
    try {
      const res = await fetch(`/sounds/${name}.mp3`);
      files[name] = await a.decodeAudioData(await res.arrayBuffer());
    } catch {
      /* лишається синтез */
    }
  };
  loading = Promise.all([load('bell'), load('fireworks')]).then(() => {});
}

/** Записаний салют завантажено — окремі вибухи не синтезуємо. */
export function hasRecordedFireworks(): boolean {
  return files.fireworks !== null;
}

/** Останні вибухи (час ctx) — не більше 6 звуків на секунду. */
let recentBursts: number[] = [];

function emit() {
  for (const l of listeners) l();
}

export function sceneSoundOn(): boolean {
  if (on === null) on = typeof window !== 'undefined' && readSoundFlag();
  return on;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Звук сцени ввімкнено (для кнопки звуку). */
export function useSceneSound(): boolean {
  return useSyncExternalStore(subscribe, sceneSoundOn, () => false);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Браузер дозволяє звук після жесту людини: будь-який дотик на сторінці «розморожує» контекст.
    document.addEventListener('pointerdown', () => void ctx?.resume().catch(() => {}), { passive: true });
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

/** Увімкнути звук сцени — з обробника кліку (жест людини). */
export function enableSceneSound() {
  audio();
  preloadSceneSounds();
  on = true;
  writeSoundFlag();
  emit();
}

export function disableSceneSound() {
  on = false;
  stopFireworksSound();
  emit();
}

/** Обертони великого дзвона: [частота × основний тон, гучність, згасання, с]. */
const BELL: [number, number, number][] = [
  [0.5, 0.32, 4.5],
  [1, 0.55, 3.2],
  [1.19, 0.26, 2.4],
  [1.5, 0.2, 2],
  [2, 0.3, 1.7],
  [2.52, 0.13, 1.2],
  [3, 0.1, 0.9],
  [4.07, 0.07, 0.6],
];

/** Удар курантів. `last` — дванадцятий, трохи гучніший і довший. */
export function playChime(last = false) {
  if (!sceneSoundOn()) return;
  const a = audio();
  if (!a || !master || !noise) return;
  const t = a.currentTime + 0.01;
  if (files.bell) {
    const src = a.createBufferSource();
    src.buffer = files.bell;
    const g = a.createGain();
    g.gain.value = last ? 1 : 0.85;
    src.connect(g).connect(master);
    src.start(t);
    return;
  }
  const base = 196; // соль малої октави — низький міський дзвін
  const out = a.createGain();
  out.gain.value = last ? 0.42 : 0.34;
  out.connect(master);
  for (const [ratio, amp, decay] of BELL) {
    for (const detune of ratio <= 1 ? [0, 1.3] : [0]) {
      const o = a.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * ratio + detune;
      const g = a.createGain();
      const d = decay * (last ? 1.4 : 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp / (detune ? 2 : 1), t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }
  // Удар молота: короткий дзвінкий шум.
  const n = a.createBufferSource();
  n.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 1.2;
  const ng = a.createGain();
  ng.gain.setValueAtTime(0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  n.connect(bp).connect(ng).connect(out);
  n.start(t, Math.random());
  n.stop(t + 0.06);
}

/** Свист ракети, що злітає (тихо). `x` — 0…1 по ширині кадру. */
export function playLaunch(x = 0.5, duration = 0.9) {
  if (!sceneSoundOn()) return;
  const a = audio();
  if (!a || !master || !noise) return;
  const t = a.currentTime + 0.01;
  const n = a.createBufferSource();
  n.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + duration);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05, t + 0.15);
  g.gain.linearRampToValueAtTime(0, t + duration);
  const p = a.createStereoPanner();
  p.pan.value = (x - 0.5) * 1.2;
  n.connect(bp).connect(g).connect(p).connect(master);
  n.start(t, Math.random());
  n.stop(t + duration + 0.05);
}

/** Вибух салюту: «бум» і тріскотіння іскор. `size` — 0.5…1.3, `x` — 0…1 по ширині кадру. */
export function playBurst(size = 1, x = 0.5) {
  if (!sceneSoundOn()) return;
  const a = audio();
  if (!a || !master || !noise) return;
  const t = a.currentTime + 0.01;
  recentBursts = recentBursts.filter((b) => b > t - 1);
  if (recentBursts.length >= 6) return;
  recentBursts.push(t);
  const pan = a.createStereoPanner();
  pan.pan.value = (x - 0.5) * 1.3;
  pan.connect(master);

  // Бум: шум крізь фільтр, що закривається, і низький удар.
  const n = a.createBufferSource();
  n.buffer = noise;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t);
  lp.frequency.exponentialRampToValueAtTime(110, t + 0.9);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.85 * size, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  n.connect(lp).connect(g).connect(pan);
  n.start(t, Math.random());
  n.stop(t + 1.5);
  const o = a.createOscillator();
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.45);
  const og = a.createGain();
  og.gain.setValueAtTime(0.6 * size, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  o.connect(og).connect(pan);
  o.start(t);
  o.stop(t + 0.55);

  // Тріскотіння іскор: короткі клацання з запізненням.
  const crackles = Math.round(14 + 22 * size * Math.random());
  for (let i = 0; i < crackles; i++) {
    const ct = t + 0.25 + Math.random() * 1.3;
    const c = a.createBufferSource();
    c.buffer = noise;
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500 + Math.random() * 3000;
    const cg = a.createGain();
    const len = 0.006 + Math.random() * 0.016;
    cg.gain.setValueAtTime(0.06 + Math.random() * 0.16, ct);
    cg.gain.exponentialRampToValueAtTime(0.0001, ct + len);
    c.connect(hp).connect(cg).connect(pan);
    c.start(ct, Math.random() * 1.9);
    c.stop(ct + len + 0.01);
  }
}

/** Записаний салют опівночі з `offset` секунд (сцену відкрили пізніше); `false` — запису ще немає. */
export function startFireworksSound(offset = 0): boolean {
  if (!sceneSoundOn()) return false;
  const a = audio();
  const buf = files.fireworks;
  if (!a || !master || !buf || offset >= buf.duration - 1) return false;
  stopFireworksSound();
  const src = a.createBufferSource();
  src.buffer = buf;
  const gain = a.createGain();
  gain.gain.value = 1;
  src.connect(gain).connect(master);
  src.start(a.currentTime + 0.02, offset);
  bed = { src, gain };
  src.onended = () => {
    if (bed?.src === src) bed = null;
  };
  return true;
}

export function stopFireworksSound() {
  if (!bed || !ctx) return;
  const { src, gain } = bed;
  bed = null;
  gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  src.stop(ctx.currentTime + 1.2);
}
