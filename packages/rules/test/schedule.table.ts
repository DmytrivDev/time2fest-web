// Одна таблиця випадків правила графіка (AC-37): її проганяють тест правил, тест обгортки сайту й (SPEC-11 P5+) сервера.
import type { ScheduleToggle } from '../src/schedule/countryZone';

export interface ScheduleSpecEvent {
  id: string;
  zoneId: string;
  countryIso: string;
  hidden?: boolean;
}

/** Крихітний каталог: Z1 — 5 країн (AA із трьома подіями-містами, одна з них «регіон»), Z2 — 2 країни, Z3 — одна. */
export const scheduleSpec = {
  events: [
    { id: 'a1', zoneId: 'Z1', countryIso: 'AA' },
    { id: 'a2', zoneId: 'Z1', countryIso: 'AA' },
    { id: 'a-region', zoneId: 'Z1', countryIso: 'AA' },
    { id: 'b1', zoneId: 'Z1', countryIso: 'BB' },
    { id: 'c1', zoneId: 'Z1', countryIso: 'CC' },
    { id: 'd1', zoneId: 'Z1', countryIso: 'DD' },
    { id: 'e1', zoneId: 'Z1', countryIso: 'EE' },
    { id: 'f1', zoneId: 'Z2', countryIso: 'FF' },
    { id: 'g1', zoneId: 'Z2', countryIso: 'GG' },
    { id: 'g-hidden', zoneId: 'Z2', countryIso: 'GG', hidden: true },
    { id: 'h1', zoneId: 'Z3', countryIso: 'HH' },
  ] satisfies ScheduleSpecEvent[],
  zoneCountries: { Z1: ['AA', 'BB', 'CC', 'DD', 'EE'], Z2: ['FF', 'GG'], Z3: ['HH'] } as Record<string, string[]>,
};

/** Правило, прив'язане до каталогу: обгортка сайту й сервера дає саме такий набір функцій. */
export interface ScheduleApi {
  ZONE_SLOT_LIMIT: number;
  countryZoneEvents(eventId: string): string[];
  zoneSlotCount(zoneId: string): number;
  scheduledCountries(schedule: readonly string[], zoneId: string): string[];
  scheduleToggleResult(schedule: readonly string[], eventId: string): ScheduleToggle;
  toggleCountryZone(schedule: readonly string[], eventId: string): string[];
  replaceCountryZone(schedule: readonly string[], outIso: string, eventId: string): string[];
  mergeSchedules(accountIds: readonly string[], guestIds: readonly string[]): string[];
  validateScheduleIds(ids: readonly string[]): boolean;
}

export interface ScheduleCase {
  name: string;
  run(api: ScheduleApi): unknown;
  expected: unknown;
}

const sorted = (a: string[]) => [...a].sort();

export const scheduleCases: ScheduleCase[] = [
  { name: 'ліміт слотів — 4', run: (a) => a.ZONE_SLOT_LIMIT, expected: 4 },
  { name: 'дві події-міста однієї країни в поясі — одна країна', run: (a) => sorted(a.countryZoneEvents('a1')), expected: ['a-region', 'a1', 'a2'] },
  { name: 'регіон як нова подія-місто тієї ж країни — не новий слот', run: (a) => a.scheduledCountries(['a1', 'a-region'], 'Z1'), expected: ['AA'] },
  { name: 'невідома подія — лише вона', run: (a) => a.countryZoneEvents('nope'), expected: ['nope'] },
  { name: 'пояс із 5 країнами — 4 слоти', run: (a) => a.zoneSlotCount('Z1'), expected: 4 },
  { name: 'пояс із 2 країнами — 2 слоти', run: (a) => a.zoneSlotCount('Z2'), expected: 2 },
  { name: 'пояс з 1 країною — 1 слот', run: (a) => a.zoneSlotCount('Z3'), expected: 1 },
  { name: 'країни графіка — у порядку додавання', run: (a) => a.scheduledCountries(['c1', 'a1', 'b1', 'a2', 'f1'], 'Z1'), expected: ['CC', 'AA', 'BB'] },
  { name: 'додати країну — усі її події', run: (a) => sorted(a.toggleCountryZone([], 'a2')), expected: ['a-region', 'a1', 'a2'] },
  { name: 'натиск на будь-яку подію країни прибирає всі', run: (a) => a.toggleCountryZone(['a1', 'a2', 'a-region', 'b1'], 'a-region'), expected: ['b1'] },
  { name: 'результат: added', run: (a) => a.scheduleToggleResult(['b1'], 'a1'), expected: 'added' },
  { name: 'результат: removed', run: (a) => a.scheduleToggleResult(['a2'], 'a1'), expected: 'removed' },
  {
    name: 'повний пояс: пʼята країна — full, графік без змін',
    run: (a) => [a.scheduleToggleResult(['a1', 'b1', 'c1', 'd1'], 'e1'), a.toggleCountryZone(['a1', 'b1', 'c1', 'd1'], 'e1')],
    expected: ['full', ['a1', 'b1', 'c1', 'd1']],
  },
  { name: 'пояс із 2 країн, обидві в графіку — натиск прибирає', run: (a) => a.scheduleToggleResult(['f1', 'g1'], 'g1'), expected: 'removed' },
  { name: 'пояс із 2 країн повний, інший пояс вільний', run: (a) => a.scheduleToggleResult(['f1', 'g1'], 'h1'), expected: 'added' },
  { name: 'заміна лишає місце в порядку', run: (a) => a.replaceCountryZone(['f1', 'b1', 'c1', 'd1', 'h1'], 'BB', 'e1'), expected: ['f1', 'e1', 'c1', 'd1', 'h1'] },
  { name: 'заміна країни з кількома подіями на одну', run: (a) => a.replaceCountryZone(['a1', 'a2', 'b1'], 'AA', 'c1'), expected: ['c1', 'b1'] },
  { name: 'заміна на невідому подію — без змін', run: (a) => a.replaceCountryZone(['a1'], 'AA', 'nope'), expected: ['a1'] },
  {
    name: 'злиття 3+2 → 4 (3 з акаунта), зайва країна гостя відкинута',
    run: (a) => a.mergeSchedules(['a1', 'a2', 'a-region', 'b1', 'c1'], ['d1', 'e1']),
    expected: ['a1', 'a2', 'a-region', 'b1', 'c1', 'd1'],
  },
  { name: 'злиття: країна гостя, що вже є в акаунті, не дублюється', run: (a) => a.mergeSchedules(['a1', 'a2', 'a-region'], ['a1', 'b1']), expected: ['a1', 'a2', 'a-region', 'b1'] },
  { name: 'злиття: події акаунта першими, пояси незалежні', run: (a) => a.mergeSchedules(['f1'], ['h1', 'g1']), expected: ['f1', 'h1', 'g1'] },
  { name: 'злиття: невідомі події гостя відкидаються', run: (a) => a.mergeSchedules([], ['nope', 'h1']), expected: ['h1'] },
  { name: 'валідація: усі відомі', run: (a) => a.validateScheduleIds(['a1', 'f1']), expected: true },
  { name: 'валідація: невідомий id', run: (a) => a.validateScheduleIds(['a1', 'nope']), expected: false },
  { name: 'валідація: прихована подія', run: (a) => a.validateScheduleIds(['g-hidden']), expected: false },
  { name: 'валідація: порожній графік', run: (a) => a.validateScheduleIds([]), expected: true },
];
