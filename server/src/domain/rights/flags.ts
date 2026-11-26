/** SPEC-11 W19 — allowed flag codes (AC-33, [Q5]): catalog ISO alpha-2 plus the special codes. Pure. */
import { SPECIAL_FLAG_CODES } from '@time2fest/contracts';

const SPECIAL: ReadonlySet<string> = new Set(SPECIAL_FLAG_CODES);

export function isAllowedFlag(code: string, catalogIsos: ReadonlySet<string> | readonly string[]): boolean {
  if (SPECIAL.has(code)) return true;
  return catalogIsos instanceof Set ? catalogIsos.has(code) : (catalogIsos as readonly string[]).includes(code);
}
