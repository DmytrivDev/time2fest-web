/**
 * Смужка кольорів прапора над листівкою (рішення власника 2026-11-07): шаблонні листівки різних країн стають
 * розрізненими без нових ілюстрацій. Кольори — `lib/flags/colors.json`, зліва направо.
 */
import { flagColors } from '@/lib/flags/colors';
import s from './passport.module.css';

export function FlagStrip({ code }: { code: string }) {
  const cols = flagColors(code);
  const bg = cols.length > 1 ? `linear-gradient(90deg, ${cols.join(', ')})` : (cols[0] ?? 'transparent');
  return <span aria-hidden="true" className={s.strip} style={{ background: bg }} />;
}
