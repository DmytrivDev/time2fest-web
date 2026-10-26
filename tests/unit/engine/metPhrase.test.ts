import { describe, expect, it } from 'vitest';
import type { Gender } from '@/lib/data/types';
import { metPhrase, renderMetPhraseUk } from '@/lib/engine/metPhrase';

const c = (name: string, gender: Gender) => ({ name: { uk: name }, gender });
const text = (input: Parameters<typeof metPhrase>[0]) => renderMetPhraseUk(metPhrase(input));

describe('metPhrase', () => {
  it.each([
    ['Ізраїль', 'm', 'Ізраїль зустрів Новий рік'],
    ['Велика Британія', 'f', 'Велика Британія зустріла Новий рік'],
    ['Об’єднане Королівство', 'n', 'Об’єднане Королівство зустріло Новий рік'],
    ['Філіппіни', 'pl', 'Філіппіни зустріли Новий рік'],
  ] as const)('%s (%s)', (name, gender, expected) => {
    expect(text(c(name, gender))).toBe(expected);
    expect(metPhrase(c(name, gender))).toEqual({ kind: 'single', key: 'met.single', params: { name, gender } });
  });

  it('null → «<Країна> · Новий рік настав»', () => {
    expect(text(c('Велика Британія', null))).toBe('Велика Британія · Новий рік настав');
    expect(metPhrase(c('Велика Британія', null)).kind).toBe('fallback');
  });

  it('≥2 країн — завжди множина, незалежно від роду', () => {
    expect(text([c('Франція', 'f'), c('Німеччина', 'f'), c('Італія', 'f')])).toBe(
      'Франція, Німеччина й Італія зустріли Новий рік',
    );
    expect(text([c('Ізраїль', 'm'), c('Тувалу', null)])).toBe('Ізраїль й Тувалу зустріли Новий рік');
    expect(metPhrase([c('Ізраїль', 'm'), c('Тувалу', null)]).kind).toBe('multi');
  });

  it('масив з однієї країни — як одна країна', () => {
    expect(text([c('Японія', 'f')])).toBe('Японія зустріла Новий рік');
  });

  it('довга назва «Демократична Республіка Конго» без скорочень і відмінювання', () => {
    expect(text(c('Демократична Республіка Конго', 'f'))).toBe('Демократична Республіка Конго зустріла Новий рік');
    expect(text(c('Демократична Республіка Конго', null))).toBe('Демократична Республіка Конго · Новий рік настав');
  });
});
