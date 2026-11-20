// @ts-check
// Профіль вузла спайку compose.rtspike.yml: нічого не публікується назовні, ті самі дайджести образів, що й у
// compose.yml, конфігурація Centrifugo — клас rehearsal рядок у рядок, крім дозволених для спайку відмінностей;
// дві копії cloudflared з розширеним діапазоном портів і nofile.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (/** @type {string} */ name) => readFileSync(new URL(`../../node/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Сервіси (відступ 2) і їхні рядки, без коментарів. @param {string} text */
function services(text) {
  /** @type {Record<string, string[]>} */
  const out = {};
  let top = '';
  let cur = '';
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    const t = line.match(/^([a-z]+):/);
    if (t) {
      top = t[1];
      cur = '';
      continue;
    }
    const s = line.match(/^ {2}([a-z0-9_-]+):/);
    if (s && top === 'services') {
      cur = s[1];
      out[cur] = [line];
      continue;
    }
    if (top === 'services' && cur) out[cur].push(line);
  }
  return out;
}

/** @param {string[]} body @param {string} key */
function block(body, key) {
  const i = body.findIndex((l) => l === `    ${key}:`);
  /** @type {string[]} */
  const out = [];
  if (i === -1) return out;
  for (const l of body.slice(i + 1)) {
    if (!/^ {6}/.test(l)) break;
    out.push(l);
  }
  return out;
}

/** @param {string[]} body */
const image = (body) => body.find((l) => /^ {4}image:/.test(l))?.trim() ?? '';

describe('node compose.rtspike.yml', () => {
  const text = read('compose.rtspike.yml');
  const spike = services(text);
  const main = services(read('compose.yml'));

  it('services: redis, centrifugo, дві копії cloudflared, видавець і збирач за профілями; без ports', () => {
    expect(Object.keys(spike).sort()).toEqual(['centrifugo', 'cloudflared-a', 'cloudflared-b', 'collector', 'publisher', 'redis']);
    expect(text.split('\n').filter((l) => /^\s*ports:/.test(l))).toEqual([]);
    expect(spike.publisher.join('\n')).toMatch(/profiles: \["run"\]/);
    expect(spike.collector.join('\n')).toMatch(/profiles: \["collector"\]/);
    expect(text).toMatch(/networks:\n {2}spike:\n {4}internal: true/);
  });

  it('образи redis, centrifugo, cloudflared — ті самі дайджести, що в compose.yml', () => {
    expect(image(spike.redis)).toBe(image(main.redis));
    expect(image(spike.centrifugo)).toBe(image(main.centrifugo));
    expect(image(spike['cloudflared-a'])).toBe(image(main.cloudflared));
    expect(spike['cloudflared-b'][0]).toMatch(/cloudflared-b: \*cloudflared/);
  });

  it('Centrifugo: оточення класу rehearsal рядок у рядок, крім походження, історії live, метрик, журналу й межі пам’яті', () => {
    const allowed = /^ {6}(CENTRIFUGO_CLIENT_ALLOWED_ORIGINS|CENTRIFUGO_PROMETHEUS_ENABLED|CENTRIFUGO_LOG_LEVEL|GOMEMLIMIT):/;
    const mine = block(spike.centrifugo, 'environment')
      .filter((l) => !allowed.test(l))
      .map((l) => l.replace('${SPIKE_LIVE_HISTORY_SIZE:-10}', '10'));
    const theirs = block(main.centrifugo, 'environment').filter((l) => !allowed.test(l));
    expect(mine).toEqual(theirs);
    const env = block(spike.centrifugo, 'environment').join('\n');
    expect(env).toContain("CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: '${SPIKE_ORIGIN:-https://rt-spike.time2fest.com}'");
    expect(env).toContain("CENTRIFUGO_PROMETHEUS_ENABLED: 'true'");
    expect(spike.centrifugo.join('\n')).toMatch(/nofile:\n {8}soft: 200000\n {8}hard: 200000/);
  });

  it('cloudflared: токен з env-файлу, порти 1024–65000, nofile 200000, метрики всередині, протокол — змінною', () => {
    const c = spike['cloudflared-a'].join('\n');
    expect(c).toMatch(/env_file: cloudflared\.env/);
    expect(c).toMatch(/net\.ipv4\.ip_local_port_range: "1024 65000"/);
    expect(c).toMatch(/soft: 200000/);
    expect(c).toMatch(/--protocol \$\{SPIKE_TUNNEL_PROTOCOL:-auto\}/);
    expect(c).toMatch(/--metrics 0\.0\.0\.0:2000/);
    expect(c).not.toMatch(/TUNNEL_TOKEN/);
  });
});
