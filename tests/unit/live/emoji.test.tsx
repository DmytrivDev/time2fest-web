import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REACTION_SYMBOLS } from '@/components/chat/reactions';
import { brandEmojiSrc, Emoji, EmojiText } from '@/components/primitives/Emoji';
import { BRAND_EMOJI } from '@/lib/emoji/brand';
import { EMOTIONS } from '@/lib/firstrow/emotions';

describe('фірмові емодзі (рішення 2026-10-31)', () => {
  it('усі емоції «Першого ряду» й реакції чату мають фірмовий значок', () => {
    const missing = [...EMOTIONS.map((e) => e.symbol), ...Object.values(REACTION_SYMBOLS)].filter((c) => !brandEmojiSrc(c));
    expect(missing).toEqual([]);
    expect(Object.keys(BRAND_EMOJI)).toHaveLength(31);
  });

  it('кожен файл значка — коректний SVG (інакше браузер не покаже його як картинку)', () => {
    const dir = join(process.cwd(), 'public', 'emoji');
    const bad = readdirSync(dir)
      .filter((f) => f.endsWith('.svg'))
      .filter((f) => new DOMParser().parseFromString(readFileSync(join(dir, f), 'utf8'), 'image/svg+xml').querySelector('parsererror'));
    expect(bad).toEqual([]);
  });

  it('значок лежить поверх стандартного символу — текст (і копіювання) лишається 🥂', () => {
    const { container } = render(<Emoji char="🥂" label="Келихи" />);
    const el = container.querySelector('[data-emoji]')!;
    expect(el.querySelector('img')).toHaveAttribute('src', '/emoji/1f942.svg');
    expect(el).toHaveTextContent('🥂');
    expect(el).toHaveAttribute('aria-label', 'Келихи');
  });

  it('EmojiText: відомі емодзі — значки, невідомі й текст — як є; ❤️ з U+FE0F теж знаходить', () => {
    const { container } = render(
      <p>
        <EmojiText text="Салют 🎆 і ❤️, а це 🥹" />
      </p>,
    );
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.textContent).toBe('Салют 🎆 і ❤️, а це 🥹');
  });
});
