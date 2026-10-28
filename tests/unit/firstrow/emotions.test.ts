import { describe, expect, it } from 'vitest';
import uk from '@/messages/uk.json';
import { canonicalEmotion, EMOTION_IDS, emotionSymbol } from '@/lib/firstrow/emotions';

describe('набір емоцій «Першого ряду»', () => {
  it('16 емоцій, кожна має назву в uk.json', () => {
    expect(EMOTION_IDS).toHaveLength(16);
    const names = uk.windows.emoji.names as Record<string, string>;
    for (const id of EMOTION_IDS) expect(names[id]).toBeTruthy();
    expect(Object.keys(names)).toHaveLength(16);
  });

  it('старі id приводяться до найближчих нових, невідомі — «Іскри»', () => {
    expect(canonicalEmotion('hat')).toBe('party');
    expect(canonicalEmotion('laugh')).toBe('joy');
    expect(canonicalEmotion('clap')).toBe('confetti');
    expect(canonicalEmotion('nope')).toBe('sparkles');
    expect(canonicalEmotion(undefined)).toBe('glasses');
    expect(emotionSymbol('star')).toBe('🌟');
  });
});
