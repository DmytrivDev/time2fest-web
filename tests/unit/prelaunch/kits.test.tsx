import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HowToCard } from '@/components/live/HowToCard';
import { kitIcon, sceneFile, sceneOf, unitKey } from '@/lib/prelaunch/kits';
import { describedIsos } from '@/lib/prelaunch/siteData';
import { renderWithApp } from '../_support/render';

// Набори «країна + пояс» (`docs/site/country-kit.md`): ключі, іконки, сцени, абзаци, точка фокусу фото.
describe('набори країн', () => {
  it('ключ одиниці — ISO@пояс', () => {
    expect(unitKey('BR', 'utc-0400')).toBe('BR@utc-0400');
  });

  it('іконка набору: відома — своя, невідома й порожня — undefined (наявний словник)', () => {
    expect(kitIcon('bell')).toBe('tradition-bell');
    expect(kitIcon('music')).toBe('tradition-music');
    expect(kitIcon('sun')).toBe('tradition-sun');
    expect(kitIcon('unknown-icon')).toBeUndefined();
    expect(kitIcon(undefined)).toBeUndefined();
  });

  it('сцена з файла: пояс, для головного — країна; чужий пояс і країна без файла — нічого', () => {
    // Пачка 2: затверджені набори — широкі сцени 480×200 з кольорами тла.
    expect(sceneFile('BR', 'utc-0400', false)).toMatchObject({
      src: '/scenes/BR-utc-0400-wide.svg',
      position: 'right center',
      wide: { sky: expect.stringMatching(/^#[0-9a-f]{6}$/), water: expect.stringMatching(/^#[0-9a-f]{6}$/) },
    });
    expect(sceneFile('JP', 'utc+0900', true)).toMatchObject({ src: '/scenes/JP-wide.svg', position: 'right center' });
    expect(sceneFile('JP', 'utc+0900', false)).toBeUndefined();
    expect(sceneFile('BR', 'utc-0300', true)).toMatchObject({ src: '/scenes/BR-wide.svg' });
    expect(sceneFile('BR', 'utc-0300', false)).toBeUndefined();
    // Пачка 3: FR теж широка; TH — новий набір.
    expect(sceneFile('FR', 'utc+0100', true)).toMatchObject({ src: '/scenes/FR-wide.svg', position: 'right center' });
    expect(sceneFile('TH', 'utc+0700', true)).toMatchObject({ src: '/scenes/TH-wide.svg' });
    expect(sceneFile('EH', 'utc+0100', true)).toBeUndefined(); // EH — без набору (притримано)
  });

  it('запис сцени: шлях 3:2 — верх по центру; широка — правий край і кольори тла; фокус 3:2 — свій', () => {
    expect(sceneOf('/scenes/NZ.svg')).toEqual({ src: '/scenes/NZ.svg', position: '50% 0%' });
    expect(sceneOf({ src: '/scenes/NZ.svg', position: { x: 40, y: 20 } })).toEqual({
      src: '/scenes/NZ.svg',
      position: '40% 20%',
    });
    expect(sceneOf({ src: '/scenes/NZ-wide.svg', wide: true, sky: '#111', water: '#222' })).toEqual(
      {
        src: '/scenes/NZ-wide.svg',
        position: 'right center',
        wide: { sky: '#111', water: '#222' },
      },
    );
    expect(sceneOf({ src: '/scenes/NZ-wide.svg', wide: true }).wide).toEqual({});
  });

  it('описані країни — без ключів поясів', () => {
    for (const locale of ['uk', 'en', 'es', 'fr'] as const) {
      const isos = describedIsos(locale);
      expect(isos).toContain('JP');
      expect(isos.some((k) => k.includes('@'))).toBe(false);
    }
  });
});

describe('HowToCard з набором', () => {
  const traditions = [
    { id: 't1', iconId: 'bell', title: 'Дзвони', text: 'Сто вісім ударів.' },
    { id: 't2', iconId: 'nope', title: 'Інше', text: 'Текст.' },
    { id: 't3', iconId: 'fireworks', title: 'Салют', text: 'Текст.' },
  ];

  it('розповідь ділиться на абзаци за порожнім рядком', () => {
    const { container } = renderWithApp(
      <HowToCard
        country="Японія"
        traditions={traditions}
        text={'Перший абзац.\n\nДругий абзац.'}
        variant="full"
      />,
    );
    expect(screen.getByText('Перший абзац.')).toBeInTheDocument();
    expect(screen.getByText('Другий абзац.')).toBeInTheDocument();
    expect(container.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
  });

  it('iconFor підміняє іконку; невідома — запасна з наявного словника', () => {
    const seen: (string | undefined)[] = [];
    renderWithApp(
      <HowToCard
        country="Японія"
        traditions={traditions}
        variant="full"
        iconFor={(id) => {
          seen.push(id);
          return kitIcon(id);
        }}
      />,
    );
    expect(seen).toEqual(expect.arrayContaining(['bell', 'nope', 'fireworks']));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  it('точка фокусу фото — object-position, без неї — без стилю', () => {
    const { container } = renderWithApp(
      <HowToCard
        country="Японія"
        traditions={traditions}
        variant="full"
        gallery={[
          { src: '/a.jpg', alt: 'a', author: 'x', license: 'CC0', position: { x: 50, y: 62 } },
        ]}
      />,
    );
    const img = container.querySelector('img[src="/a.jpg"]') as HTMLImageElement;
    expect(img.style.objectPosition).toBe('50% 62%');
  });
});
