// @ts-check
// Хто тримає ім’я робочого домену перед `wrangler deploy` середовища `prelaunch`/`production` (F1, AC-21).
// `wrangler deploy` сам ставить `override_existing_origin`/`override_existing_dns_record`: без цієї перевірки
// розгортання мовчки забирає ім’я в іншого Worker’а чи замінює запис DNS старого сайту. Тут: для кожного хоста
// маршрутів середовища — прив’язки Custom Domain (`GET /accounts/<a>/workers/domains?hostname=`) і записи зони
// (`GET /zones/<z>/dns_records?name=`). Чужий тримач — відмова (код 2), якщо `--take-domain-from` не називає саме
// його. Будь-яке «не вдалося прочитати» — теж відмова з назвою того, чого бракує: перевірку не пропускаємо.
// Ця сама перевірка продубльована в `workers/edge/scripts/deploy.mjs` (інший пакет не імпортує з `infra/ops`).

/** Значення `--take-domain-from` для записів DNS, що не належать жодному Worker’у. */
export const TAKE_FROM_DNS = 'dns';
/** Права токена, яких бракує при 401/403. */
export const RIGHT_WORKERS_READ = 'Account → Workers Scripts → Read (прив’язки Custom Domain)';
export const RIGHT_DNS_READ = 'Zone → DNS → Read (записи зони робочого домену)';
const ADDRESS_TYPES = ['A', 'AAAA', 'CNAME'];

/**
 * @typedef {import('./cloudflareApi.mjs').CloudflareApi} CfApi
 * @typedef {{ ok: true, taken: string[] } | { ok: false, code: 2, message: string }} HolderCheck `taken` — тримачі,
 *   яких дозволив забрати `--take-domain-from`.
 */

/** @param {string} s */
const norm = (s) => String(s).trim().toLowerCase().replace(/\.$/, '');

/**
 * Запис DNS, створений Custom Domain Worker’а (Cloudflare позначає його лише для читання / прив’язує до Worker’а).
 * @param {any} r
 */
export function isWorkerRecord(r) {
  return r?.meta?.read_only === true || typeof r?.meta?.origin_worker_id === 'string' || (r?.type === 'AAAA' && r?.content === '100::');
}

/**
 * @param {{ ok: boolean, status: number }} r
 * @param {string} right
 * @param {string} what
 */
function readFailure(r, right, what) {
  if (r.status === 401 || r.status === 403) return `${what}: токену бракує права ${right} — перевірку тримача не пропускаю`;
  return `${what}: Cloudflare відповів HTTP ${r.status} — перевірку тримача не пропускаю`;
}

/**
 * @param {{
 *   api: CfApi,
 *   hosts: string[],
 *   worker: string,
 *   takeFrom?: string,
 * }} o `hosts` — хости маршрутів середовища; `worker` — ім’я Worker’а, що розгортається; `takeFrom` — `--take-domain-from`.
 * @returns {Promise<HolderCheck>}
 */
export async function checkDomainHolders(o) {
  /** @param {string} message @returns {{ ok: false, code: 2, message: string }} */
  const refuse = (message) => ({ ok: false, code: 2, message });
  if (!o.api.zone) return refuse('бракує змінної CLOUDFLARE_ZONE_ID (зона робочого домену) — перевірку тримача не пропускаю');
  if (!o.hosts.length) return refuse('у маршрутах середовища немає хостів — нема що перевіряти');
  const self = norm(o.worker);
  /** @type {Set<string>} */
  const taken = new Set();

  for (const host of o.hosts.map(norm)) {
    /** @type {Set<string>} */
    const holders = new Set();
    let r;
    try {
      r = await o.api.get(`/workers/domains?hostname=${encodeURIComponent(host)}`);
    } catch {
      return refuse(`${host}: прив’язки Custom Domain не прочитано (мережа) — перевірку тримача не пропускаю`);
    }
    if (!r.ok || !Array.isArray(r.body?.result)) return refuse(readFailure(r, RIGHT_WORKERS_READ, `${host}: прив’язки Custom Domain`));
    for (const d of r.body.result) {
      if (norm(String(d?.hostname ?? host)) !== host) continue;
      const service = norm(String(d?.service ?? ''));
      if (service !== self) holders.add(service || 'невідомий Worker');
    }

    try {
      r = await o.api.getZone(`/dns_records?name=${encodeURIComponent(host)}&per_page=100`);
    } catch {
      return refuse(`${host}: записи DNS не прочитано (мережа) — перевірку тримача не пропускаю`);
    }
    if (!r.ok || !Array.isArray(r.body?.result)) return refuse(readFailure(r, RIGHT_DNS_READ, `${host}: записи DNS`));
    for (const rec of r.body.result) {
      if (norm(String(rec?.name ?? '')) !== host || !ADDRESS_TYPES.includes(String(rec?.type))) continue;
      if (!isWorkerRecord(rec)) holders.add(TAKE_FROM_DNS);
    }

    if (holders.size === 0) continue;
    const list = [...holders].sort().join(', ');
    if (o.takeFrom === undefined) {
      return refuse(`${host} зараз тримає ${list}; розгортання забрало б ім’я — лише з --take-domain-from <тримач>`);
    }
    if (holders.size !== 1 || !holders.has(norm(o.takeFrom))) {
      return refuse(`${host} зараз тримає ${list}, а --take-domain-from називає ${o.takeFrom} — не збігається`);
    }
    taken.add(norm(o.takeFrom));
  }

  if (o.takeFrom !== undefined && taken.size === 0) {
    return refuse(`--take-domain-from ${o.takeFrom}: ${o.takeFrom} не тримає жодного з імен ${o.hosts.join(', ')} — прапорець зайвий`);
  }
  return { ok: true, taken: [...taken] };
}
