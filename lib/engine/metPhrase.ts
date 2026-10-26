/**
 * «<Країна> зустріла Новий рік» (`data-model.md` 1.1, принцип IV, FR-090).
 * Дієслово — з `gender`; ≥2 країн — завжди множина; `null` → «<Країна> · Новий рік настав».
 * Назви лише в називному відмінку, без відмінювання.
 *
 * Двигун повертає ключ і параметри для `messages/uk.json` (ICU `select` за родом);
 * `renderMetPhraseUk` — запасний рендер українською для оголошень і тестів.
 */
import type { Country, Gender } from '@/lib/data/types';

type CountryLike = Pick<Country, 'name' | 'gender'>;

export type MetPhrase =
  | { kind: 'single'; key: 'met.single'; params: { name: string; gender: Exclude<Gender, null> } }
  | { kind: 'multi'; key: 'met.multi'; params: { names: string[] } }
  | { kind: 'fallback'; key: 'met.fallback'; params: { name: string } };

export const MET_VERB_UK: Record<Exclude<Gender, null>, string> = {
  m: 'зустрів',
  f: 'зустріла',
  n: 'зустріло',
  pl: 'зустріли',
};

export function metPhrase(input: CountryLike | readonly CountryLike[]): MetPhrase {
  const list = Array.isArray(input) ? (input as readonly CountryLike[]) : [input as CountryLike];
  if (list.length >= 2) return { kind: 'multi', key: 'met.multi', params: { names: list.map((c) => c.name.uk) } };
  const c = list[0];
  if (!c) throw new Error('metPhrase: потрібна хоча б одна країна');
  if (c.gender === null) return { kind: 'fallback', key: 'met.fallback', params: { name: c.name.uk } };
  return { kind: 'single', key: 'met.single', params: { name: c.name.uk, gender: c.gender } };
}

/** «Франція, Німеччина й Італія». */
export function joinNamesUk(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} й ${names[names.length - 1]}`;
}

export function renderMetPhraseUk(p: MetPhrase): string {
  switch (p.kind) {
    case 'single':
      return `${p.params.name} ${MET_VERB_UK[p.params.gender]} Новий рік`;
    case 'multi':
      return `${joinNamesUk(p.params.names)} ${MET_VERB_UK.pl} Новий рік`;
    case 'fallback':
      return `${p.params.name} · Новий рік настав`;
  }
}
