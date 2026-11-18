/**
 * Документи передстартового сайту: конфіденційність, cookies, умови. Тексти — файли `content/prelaunch/legal/
 * <документ>.<мова>.md` (їх готує задача C; формат — як у чернетках `docs/site/prelaunch-content/legal/`):
 *
 *   # Назва
 *   - **id:** … · **адреса:** …
 *   - **у перемикачі:** Назва · **коротко про що:** …   ← назва в навігації й «Інших документах»
 *   - **оновлено:** 1 грудня 2026            ← останній рядок переліку — дата
 *   **Коротко.** Один абзац.
 *   ## Розділ {#id}
 *   абзаци, списки `- ` і `1. `, таблиці `| … |`, **жирний**, [посилання](/шлях/)
 *
 * Розбір перетворює текст у формат наявної сторінки документів сайту (`LegalDoc` з `lib/legal/docs.ts`), а показує
 * його наявний вигляд (`components/legal/LegalDocView`). Читається з диска під час збирання (лише на сервері). Місця у `[[подвійних дужках]]` — незаповнені: перевірка
 * збірки для домену рахує їх як заглушки.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import type { LegalBlock, LegalDoc as SiteLegalDoc } from '@/lib/legal/docs';

export const LEGAL_IDS = ['privacy', 'cookies', 'terms'] as const;
export type LegalId = (typeof LEGAL_IDS)[number];

export type { LegalBlock };

/** Документ у форматі сайту + мова тексту (може відрізнятись від мови сторінки, якщо перекладу ще немає). */
export interface LegalDoc extends SiteLegalDoc {
  id: LegalId;
  locale: Locale;
}

const DIR = path.join(process.cwd(), 'content', 'prelaunch', 'legal');

export function parseLegal(id: LegalId, locale: Locale, source: string): LegalDoc {
  const lines = source
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');
  const doc: LegalDoc = {
    id,
    locale,
    href: `/${id}/`,
    tab: '',
    about: '',
    title: '',
    updated: '',
    short: '',
    sections: [],
  };
  let metaWithParts = 0;
  let blocks: LegalBlock[] | null = null;
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join(' ').trim();
    para = [];
    if (!text) return;
    if (blocks) blocks.push({ kind: 'p', text });
    else if (!doc.short && text.startsWith('**')) doc.short = text.replace(/^\*\*[^*]+\*\*\s*/, '');
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trimEnd();
    if (line.startsWith('# ')) {
      doc.title = line.slice(2).trim();
      continue;
    }
    const h = /^##\s+(.*?)\s*(?:\{#([\w-]+)\})?$/.exec(line);
    if (h) {
      flush();
      blocks = [];
      doc.sections.push({ id: h[2] ?? `s${doc.sections.length + 1}`, title: h[1]!, blocks });
      continue;
    }
    if (!blocks) {
      // Службові рядки над першим розділом: з них потрібна лише дата (останній пункт переліку).
      const meta = /^- \*\*[^*]+:\*\*\s*(.+)$/.exec(line);
      if (meta && !line.includes('·')) doc.updated = meta[1]!.trim();
      else if (meta) {
        // Другий рядок із «·» — назва в перемикачі й «коротко про що».
        metaWithParts += 1;
        if (metaWithParts === 2) {
          const values = line
            .slice(2)
            .split(' · ')
            .map((p) => p.replace(/^\*\*[^*]+:\*\*\s*/, '').trim());
          doc.tab = values[0] ?? '';
          doc.about = values[1] ?? '';
        }
      }
      else if (!line.startsWith('- ')) {
        if (line.trim() === '') flush();
        else para.push(line.trim());
      }
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    const list = /^(-|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      flush();
      const kind = list[1] === '-' ? 'ul' : 'ol';
      const last = blocks.at(-1);
      if (last && last.kind === kind) last.items.push(list[2]!);
      else blocks.push({ kind, items: [list[2]!] });
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const rows: string[][] = [];
      const head = cells(line);
      while (lines[i + 1]?.trim().startsWith('|')) {
        i += 1;
        const row = cells(lines[i]!);
        if (!row.every((c) => /^:?-+:?$/.test(c))) rows.push(row);
      }
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  if (!doc.tab) doc.tab = doc.title;
  return doc;
}

/** Документ мовою сторінки; якщо перекладу немає — головною мовою (тоді сторінка показує примітку про чинну версію). */
export function loadLegal(id: LegalId, locale: Locale): LegalDoc {
  for (const l of [locale, DEFAULT_LOCALE] as const) {
    const file = path.join(DIR, `${id}.${l}.md`);
    if (fs.existsSync(file)) return parseLegal(id, l, fs.readFileSync(file, 'utf8'));
  }
  throw new Error(`legal: немає файла content/prelaunch/legal/${id}.${locale}.md`);
}
