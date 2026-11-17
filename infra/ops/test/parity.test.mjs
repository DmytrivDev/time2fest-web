// @ts-check
// Паритет копій правил між пакетами: ops, infra/cloudflare і розгортання Worker’а мають однакові хости робочого
// домену й однаковий перелік середовищ робочого домену. Копії живуть окремо (пакети без спільної залежності),
// тож рівність тримає цей тест.
import { describe, expect, it } from 'vitest';
import { MAIN_HOSTS as CF_MAIN_HOSTS } from '../../cloudflare/lib/config.mjs';
import { MAIN_DOMAIN_ENVS } from '../../../workers/edge/scripts/deploy.mjs';
import { ENVS, MAIN_HOSTS } from '../lib/config.mjs';
import { REHEARSAL_NAME } from '../lib/moveDomain.mjs';

describe('паритет правил робочого домену', () => {
  it('MAIN_HOSTS однакові в ops і infra/cloudflare', () => {
    expect([...MAIN_HOSTS].sort()).toEqual([...CF_MAIN_HOSTS].sort());
  });

  it('MAIN_DOMAIN_ENVS розгортання Worker’а = середовища ops з mainDomain', () => {
    const opsMain = Object.keys(ENVS).filter((e) => ENVS[e].mainDomain === true);
    expect([...MAIN_DOMAIN_ENVS].sort()).toEqual(opsMain.sort());
  });

  it('ім’я репетиції move-domain = ENVS.rehearsal.siteHost', () => {
    expect(REHEARSAL_NAME).toBe(ENVS.rehearsal.siteHost);
  });
});
