/**
 * «Тости світу» (сторінка «Підтримати», рішення власника 2026-11-07): золоті тости інших глядачів за чайові. Спільного
 * бекенду на прототипі немає — імітуємо, як чат: після кожної півночі поясу (через 2–8 хв) хтось із авторів сценарію
 * чату піднімає тост. Ті самі тости з’являються в чаті «Світ» (`worldToastMessages` в імітаторі) і в стрічці сторінки.
 */
import type { ChatMessage, ChatScriptFile, Dataset } from '@/lib/data/types';
import { TIP_AMOUNTS } from '@/lib/offers/format';

const TEXTS = [
  '🥂 З Новим роком! Дякую, що можна дивитися все разом',
  '🎆 Happy New Year from here — what a night!',
  '✨ Хай 2027 буде мирним для всіх',
  '🥂 Feliz Año Nuevo a todos 🎉',
  '🎇 Bonne année à tous ! Paris next',
  '🍾 За всіх, хто зустрічає Новий рік разом!',
  '🎆 Frohes neues Jahr aus Berlin',
  '✨ Szczęśliwego Nowego Roku!',
  '🥂 Ще один пояс — ще один келих',
  '🎉 Feliz Ano Novo do Rio!',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Усі тости світу за свято, за часом; `upTo` — лише ті, що вже прозвучали. */
export function worldToasts(script: ChatScriptFile, data: Dataset, upTo = Infinity): ChatMessage[] {
  const authors = script.authors;
  if (!authors.length) return [];
  const out: ChatMessage[] = [];
  data.zones.forEach((z, i) => {
    const h = hash(z.id);
    const at = z.midnightMs + (2 + (h % 7)) * 60_000 + (h % 50) * 1_000;
    if (at > upTo) return;
    const a = authors[h % authors.length]!;
    out.push({
      id: `toast-${z.id}`,
      room: 'world',
      kind: 'regular',
      createdAt: at,
      author: { id: a.id, nick: a.nick, flagCode: a.flagCode, badges: [...a.badges] },
      text: TEXTS[i % TEXTS.length],
      moderation: 'ok',
      toast: { amount: TIP_AMOUNTS[(h >>> 8) % TIP_AMOUNTS.length]! },
    });
  });
  return out.sort((x, y) => x.createdAt - y.createdAt);
}
