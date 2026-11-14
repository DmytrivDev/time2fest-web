/**
 * Імітовані тости інших глядачів (спільного бекенду на прототипі немає). Після кожної півночі поясу протягом години
 * автори сценарію чату піднімають тости — від двох до шести; перший — одразу після півночі, $5 чи $10 (закріплений),
 * решта — $2 / $5 / $10. Лише поки свято йде (до 2 год після останньої півночі, рішення власника 2026-11-14): після неї тост не
 * сказати — і імітованих немає, архів «Тостів світу» показує тости свята.
 * Ті самі тости — у смузі тостів, у чаті «Світ» і на сторінці «Підтримати».
 *
 * Ніякої вигаданої наповненості в робочій збірці (рішення власника 2026-11-12): імітовані тости живуть лише в тестовій
 * і демо-збірці (`IS_TEST_BUILD`; демо — та сама тестова збірка з `NEXT_PUBLIC_DEMO`). У робочій збірці без тостів
 * смуга показує порожній стан «Тостів ще немає — скажи перший».
 */
import { CELEBRATION_TAIL } from '@/lib/engine/celebration';
import type { ChatScriptFile, Dataset, Ms } from '@/lib/data/types';
import { IS_TEST_BUILD } from '@/lib/env';
import type { ToastRecord } from './feed';
import type { ToastTier } from './tiers';

/** Чи живлять імітовані тости смугу, чат і «Підтримати» (лише тестова й демо-збірка). */
export const SIMULATED_TOASTS = IS_TEST_BUILD;

const TEXTS = [
  '🥂 З Новим роком! Дякую, що можна дивитися все разом',
  '🎆 Happy New Year from here — what a night!',
  '✨ Хай 2027 буде мирним для всіх',
  '🥂 Feliz Año Nuevo a todos 🎉',
  '🎇 Bonne année à tous ! Хай кожен знайде своїх',
  '🍾 За всіх, хто зустрічає Новий рік разом!',
  '🎆 Frohes neues Jahr! Prost',
  '✨ Szczęśliwego Nowego Roku!',
  '🥂 Ще один пояс — ще один келих',
  '🎉 Feliz Ano Novo! Saúde a todos',
  '❤️ За тих, хто зараз далеко від дому, — ми з вами',
  '🌟 Cheers from everywhere',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Решта тостів поясу: $2 — 4 з 10, $5 — 3 з 10, $10 — 3 з 10. */
function tierOf(h: number): ToastTier {
  const r = h % 10;
  return r < 4 ? 2 : r < 7 ? 5 : 10;
}

/** Усі імітовані тости свята за часом (без перевірки збірки); `upTo` — лише ті, що вже прозвучали. */
export function worldToasts(script: ChatScriptFile, data: Dataset, upTo = Infinity): ToastRecord[] {
  const authors = script.authors;
  if (!authors.length) return [];
  const out: ToastRecord[] = [];
  const last = data.zones.reduce((m, z) => Math.max(m, z.midnightMs), -Infinity);
  data.zones.forEach((z, i) => {
    const count = 2 + (hash(z.id) % 5);
    for (let j = 0; j < count; j++) {
      const h = hash(`${z.id}:${j}`);
      // Перший тост поясу — одразу після півночі й дорожчий ($5 / $10), щоб у смузі були закріплені.
      const at = z.midnightMs + (j === 0 ? 1 + (h % 6) : 2 + (h % 55)) * 60_000 + ((h >>> 6) % 60) * 1_000;
      if (at > upTo || at > last + CELEBRATION_TAIL) continue;
      const a = authors[(h >>> 3) % authors.length]!;
      const tier: ToastTier = j === 0 ? ((h >>> 11) % 3 === 0 ? 10 : 5) : tierOf(h >>> 11);
      out.push({
        id: `toast-${z.id}-${j}`,
        authorId: a.id,
        nick: a.nick,
        flagCode: a.flagCode,
        text: TEXTS[(i * 3 + j) % TEXTS.length]!,
        tier,
        createdAt: at,
        pass: tier === 10 || a.badges.includes('pass'),
      });
    }
  });
  return out.sort((x, y) => x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1));
}

/** Імітовані тости, якщо збірка їх дозволяє (`SIMULATED_TOASTS`); у робочій — порожньо. */
export function simulatedToasts(script: ChatScriptFile, data: Dataset, upTo: Ms = Infinity): ToastRecord[] {
  return SIMULATED_TOASTS ? worldToasts(script, data, upTo) : [];
}
