import { cleanup } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Flag } from '@/components/primitives/Flag';
import countries from '@/data/countries.json';
import { renderApp, stubBrowserApis } from '../us1/render';

stubBrowserApis();
afterEach(cleanup);

describe('круглі прапори чату', () => {
  it('кожна країна з даних має самохостний круглий SVG у public/flags/round', () => {
    const missing = countries.countries.filter((c) => !existsSync(join(process.cwd(), 'public', 'flags', 'round', `${c.iso.toLowerCase()}.svg`)));
    expect(missing.map((c) => c.iso)).toEqual([]);
    for (const f of ['gb-eng', 'gb-sct', 'gb-wls', 'un', 'eu']) {
      expect(existsSync(join(process.cwd(), 'public', 'flags', 'round', `${f}.svg`))).toBe(true);
    }
  });

  it('коло 16 px з локальним <img>; особливі прапори без файла малюються власним SVG; прямокутного варіанта немає (2026-11-13)', () => {
    const { container } = renderApp(
      <>
        <Flag code="UA" size="xs" decorative />
        <Flag code="GB-ENG" size="xs" decorative />
        <Flag code="un" size="xs" decorative />
        <Flag code="pride" size="xs" decorative />
        <Flag code="FR" size="md" decorative />
        <Flag code="FR" diameter={24} decorative />
      </>,
    );
    const [ua, eng, un, pride, md, d24] = [...container.querySelectorAll<HTMLElement>('[data-flag]')];
    expect(ua!.dataset.round).toBe('true');
    expect(ua!.style.width).toBe('16px');
    expect(ua!.style.height).toBe('16px');
    expect(ua!.querySelector('img')!.getAttribute('src')).toBe('/flags/round/ua.svg');
    expect(eng!.querySelector('img')!.getAttribute('src')).toBe('/flags/round/gb-eng.svg');
    expect(un!.querySelector('img')!.getAttribute('src')).toBe('/flags/round/un.svg');
    expect(pride!.querySelector('img')).toBeNull();
    expect(pride!.querySelector('svg')).not.toBeNull();
    // Усі прапори — кола: розмір — діаметр, ширина дорівнює висоті.
    expect(md!.dataset.round).toBe('true');
    expect([md!.style.width, md!.style.height]).toEqual(['26px', '26px']);
    expect([d24!.style.width, d24!.style.height]).toEqual(['24px', '24px']);
    expect(container.querySelectorAll('[data-flag]:not([data-round="true"])')).toHaveLength(0);
  });
});
