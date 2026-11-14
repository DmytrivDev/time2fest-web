/**
 * Регіони країн для вікна поясу під мапою (рішення власника 2026-11-03, дошка `Desk-Map-ZonePanel`): «усі інші країни —
 * за регіонами». Таблиця ручна (ISO 3166-1 → регіон); країни, що простягаються на кілька частин світу, — за поясом.
 */
export const REGION_ORDER = [
  'europe',
  'middleEast',
  'africa',
  'asia',
  'northAmerica',
  'caribbean',
  'southAmerica',
  'oceania',
  'antarctic',
] as const;
export type RegionKey = (typeof REGION_ORDER)[number];

const LISTS: Record<RegionKey, string> = {
  europe:
    'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  middleEast: 'AE BH IL IQ IR JO KW LB OM PS QA SA SY TR YE',
  africa:
    'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  asia: 'AF AM AZ BD BN BT CC CN CX GE HK ID IN IO JP KG KH KP KR KZ LA LK MM MN MO MV MY NP PH PK SG TH TJ TL TM TW UZ VN',
  northAmerica: 'BM CA GL MX PM US',
  caribbean: 'AG AI AW BB BL BQ BS BZ CR CU CW DM DO GD GP GT HN HT JM KN KY LC MF MQ MS NI PA PR SV SX TC TT VC VG VI',
  southAmerica: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  oceania: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
  antarctic: 'AQ BV GS HM TF',
};

const BY_ISO = new Map<string, RegionKey>();
for (const key of REGION_ORDER) for (const iso of LISTS[key].split(' ')) BY_ISO.set(iso, key);

/** Регіон країни в поясі: Росія — Європа до UTC+4 включно, далі Азія. Невідома країна — `null`. */
export function regionOf(iso: string, offsetMinutes: number): RegionKey | null {
  if (iso === 'RU') return offsetMinutes <= 240 ? 'europe' : 'asia';
  return BY_ISO.get(iso) ?? null;
}
