// @ts-check
// Конфігурація адаптера DigitalOcean: розміри середовищ (вони залежать від провайдера, тому живуть тут), образ,
// базова адреса API й потрібні права токена. Лише назви — жодних значень токенів.

export const DO_API = 'https://api.digitalocean.com';
/** `DO_API_BASE` дозволено лише як loopback (тести), як `CLOUDFLARE_API_BASE` у `infra/cloudflare/lib/api.mjs`. */
export const DO_LOCAL_BASE = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
export const DO_IMAGE = 'ubuntu-24-04-x64';

/** @type {Record<string, import('../provider.mjs').EnvSizes>} */
export const ENV_SIZES = {
  rehearsal: {
    region: 'fra1',
    main: { offSeason: 's-2vcpu-4gb', allowed: ['s-2vcpu-4gb', 's-4vcpu-8gb'] },
    realtime: { size: 's-2vcpu-4gb' },
  },
  // SPEC-23 sets final night sizes.
  production: {
    region: 'fra1',
    main: { offSeason: 's-2vcpu-4gb', allowed: ['s-2vcpu-4gb', 's-4vcpu-8gb', 's-8vcpu-16gb'] },
    realtime: { size: 'c-4' },
  },
};

/** Права `DIGITALOCEAN_TOKEN` (власна роль токена, для README й латки документації). */
export const TOKEN_SCOPES = [
  'droplet:read',
  'droplet:create',
  'droplet:update',
  'droplet:delete',
  'actions:read',
  'sizes:read',
  'regions:read',
  'tag:read',
  'tag:create',
  'ssh_key:read',
  'image:read',
  'vpc:read',
];

/** Змінні середовища адаптера (лише назви). `T2F_DO_SSH_KEY` — відбиток ключа SSH власника в обліковому записі. */
export const DO_ENV = { token: 'DIGITALOCEAN_TOKEN', base: 'DO_API_BASE', sshKey: 'T2F_DO_SSH_KEY' };

/** Очікування: стан вузла, дія; м’яке вимкнення — до переходу на `power_off`. */
export const DO_TIMEOUTS = { pollMs: 5_000, nodeMs: 10 * 60_000, actionMs: 15 * 60_000, shutdownMs: 60_000 };
