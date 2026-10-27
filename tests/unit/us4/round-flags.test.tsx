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

  it('round: коло 16 px з локальним <img>; особливі прапори без файла малюються власним SVG; без round — прямокутний', () => {
    const { container } = renderApp(
      <>
        <Flag round code="UA" size="xs" decorative />
        <Flag round code="GB-ENG" size="xs" decorative />
        <Flag round code="un" size="xs" decorative />
        <Flag round code="pride" size="xs" decorative />
        <Flag code="UA" size="xs" decorative />
      </>,
    );
    const [ua, eng, un, pride, rect] = [...container.querySelectorAll<HTMLElement>('[data-flag]')];
    expect(ua!.dataset.round).toBe('true');
    expect(ua!.style.width).toBe('16px');
    expect(ua!.style.height).toBe('16px');
    expect(ua!.querySelector('img')!.getAttribute('src')).toBe('/flags/round/ua.svg');
    expect(eng!.querySelector('img')!.getAttribute('src')).toBe('/flags/round/gb-eng.svg');
    expect(un!.querySelector('img')!.getAttribute('src')).toBe('/flags/round/un.svg');
    expect(pride!.querySelector('img')).toBeNull();
    expect(pride!.querySelector('svg')).not.toBeNull();
    expect(rect!.dataset.round).toBeUndefined();
    expect(rect!.style.width).toBe('16px');
    expect(rect!.style.height).toBe('11px');
  });
});
