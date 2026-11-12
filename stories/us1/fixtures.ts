/** Дані для історій US1: країни з `data/countries.json`, автори й повідомлення чату. */
import countriesJson from '@/data/countries.json';
import type { Author, ChatMessage, CountriesFile, Country } from '@/lib/data/types';

const countries = (countriesJson as unknown as CountriesFile).countries;

export function countryOf(iso: string): Country {
  const c = countries.find((x) => x.iso === iso);
  if (!c) throw new Error(`Немає країни ${iso} у data/countries.json`);
  return c;
}

/** Назва країни за кодом прапора (у даних `flagCode` збігається з ISO). */
export function countryName(flagCode: string): string | undefined {
  return countries.find((c) => c.flagCode === flagCode)?.name.uk;
}

export const CITY_NAMES: Record<string, string> = {
  london: 'Лондон',
  sydney: 'Сідней',
  melbourne: 'Мельбурн',
  paris: 'Париж',
  nuuk: 'Нуук',
};

export const LOOKUP = {
  countryName,
  country: (iso: string) => countries.find((c) => c.iso === iso),
  cityName: (id: string) => CITY_NAMES[id],
};

/** Півночі 2027 у Лондоні. */
export const MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');

export const AMIRA: Author = { id: 'u_amira', nick: 'Аміра', flagCode: 'CA', badges: ['pass'] };
export const LIAM: Author = { id: 'u_liam', nick: 'Liam', flagCode: 'AU', badges: [] };
export const JAMES: Author = { id: 'u_james', nick: 'James', flagCode: 'GB', badges: ['pass'] };
export const ME: Author = { id: 'me', nick: 'Мирон', flagCode: 'UA', badges: [], isMine: true };

let n = 0;
function base(partial: Partial<ChatMessage> & Pick<ChatMessage, 'kind'>, at: number): ChatMessage {
  n += 1;
  return { id: `m${n}`, room: 'world', createdAt: at, moderation: 'ok', ...partial };
}

const T0 = MIDNIGHT + 96 * 60_000; // 01:36 UTC

export const regular = (author: Author, text: string, minute = 0, extra: Partial<ChatMessage> = {}) =>
  base({ kind: 'regular', author, text, ...extra }, T0 + minute * 60_000);

export const SYSTEM_MIDNIGHT: ChatMessage = base(
  { kind: 'system', system: { kind: 'country-midnight', countries: [{ iso: 'FR', gender: 'f' }, { iso: 'DE', gender: 'n' }, { iso: 'IT', gender: 'f' }], eventIds: [] } },
  T0 + 60_000,
);
export const SYSTEM_SINGLE: ChatMessage = base(
  { kind: 'system', system: { kind: 'country-midnight', countries: [{ iso: 'AU', gender: 'f' }], eventIds: [] } },
  T0 + 60_000,
);
export const SYSTEM_COUNTER: ChatMessage = base(
  { kind: 'system', system: { kind: 'greetings-counter', count: 1240, flagCodes: ['GB', 'FR', 'UA', 'JP', 'BR'], eventId: 'evt_london_2027' } },
  T0 + 3 * 60_000,
);
export const SYSTEM_SLOW: ChatMessage = base({ kind: 'system', system: { kind: 'slow-mode', seconds: 15 } }, T0 + 4 * 60_000);
export const SYSTEM_POLL: ChatMessage = base({ kind: 'system', system: { kind: 'poll-open', pollId: 'p1' } }, T0 + 5 * 60_000);

export const CHAT_SAMPLE: ChatMessage[] = [
  regular(LIAM, 'Sydney is already in 2027 — come join! 🎆', 0),
  regular(AMIRA, 'Привіт з Торонто! Тут ще 18:38 🙂', 1),
  regular(JAMES, 'The Thames is packed — see you at midnight!', 2),
  SYSTEM_MIDNIGHT,
  regular(ME, 'Вітаю з Києва!', 3),
  SYSTEM_COUNTER,
  regular(AMIRA, 'Дякую!', 4, { replyTo: { id: 'x', nick: 'Мирон', excerpt: 'Вітаю з Києва!' } }),
];
