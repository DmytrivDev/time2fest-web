/**
 * Листівка «Першого ряду» для «Поділитися листівкою» (дошка `Desk-FR-After-C`, рішення власника 2026-10-31):
 * «ПЕРШИЙ РЯД · ЛОНДОН», «З Новим 2027 роком!», одне привітання з автором і всі імена ряду з круглими прапорами;
 * 9:16 (сторіс) і 1:1. Як і картка штампа (`lib/offers/shareImage.ts`) — SVG: прев’ю миттєве, PNG — через canvas.
 * Прапори вбудовано data-URL (`flags`), щоб canvas малював їх без мережі; без прапора — сіре коло.
 */
import { SHARE_SIZE, type ShareRatio } from '@/lib/offers/shareImage';

export interface PostcardPerson {
  name: string;
  flagCode: string;
  /** Символ емоції (🎉). */
  emoji: string;
}

export interface PostcardText {
  /** «ПЕРШИЙ РЯД · ЛОНДОН». */
  kicker: string;
  /** «З Новим 2027 роком!» — переноситься на два рядки за останнім пробілом перед роком. */
  title: string;
  /** Привітання без лапок; порожнє — без блоку привітання. */
  greeting: string;
  /** Автор привітання. */
  author?: PostcardPerson;
  people: readonly PostcardPerson[];
  /** «Time2Fest · time2fest.com». */
  brand: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Перенос за словами: не більше `max` знаків у рядку (оцінка ширини), не більше `lines` рядків, решта — «…». */
export function wrapWords(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= max || !cur) cur = next;
    else {
      out.push(cur);
      cur = word;
    }
  }
  if (cur) out.push(cur);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  kept[lines - 1] = `${kept[lines - 1]!.replace(/[\s,.;:!?—-]+$/, '')}…`;
  return kept;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function flagCircle(code: string, cx: number, cy: number, r: number, flags: Record<string, string>, id: string): string {
  const src = flags[code];
  const ring = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="2"/>`;
  if (!src) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#74747D"/>${ring}`;
  return `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image href="${src}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>${ring}`;
}

export function postcardSvg(ratio: ShareRatio, text: PostcardText, flags: Record<string, string> = {}): string {
  const { w, h } = SHARE_SIZE[ratio];
  const story = ratio === 'story';
  const cx = w / 2;
  const frame = 40;
  const font = "font-family=\"Manrope, 'Segoe UI', Arial, sans-serif\"";
  const sparks = [
    [0.18, 0.1, 6, '#FCE286'],
    [0.84, 0.08, 6, '#F94A51'],
    [0.9, 0.38, 5, '#8CC7C2'],
    [0.1, 0.46, 4, '#FCE286'],
    [0.76, 0.6, 4, '#F94A51'],
  ]
    .map(([x, y, r, c]) => `<circle cx="${(x as number) * w}" cy="${(y as number) * h}" r="${r}" fill="${c}" opacity="0.75"/>`)
    .join('');

  // Заголовок: «З Новим» / «2027 роком!» — два рядки. Увесь блок (від «ПЕРШИЙ РЯД» до імен) стоїть посередині між
  // верхньою рамкою й підписом — без порожнечі в сторіс.
  const m = /^(.*?)\s+(\S*\d{4}.*)$/.exec(text.title);
  const titleLines = m ? [m[1]!, m[2]!] : [text.title];
  const titleSize = story ? 116 : 66;
  const parts: string[] = [];
  let y = 0;
  parts.push(`<text x="${cx}" y="${y}" fill="#FCE286" font-size="34" font-weight="700" letter-spacing="4">${esc(text.kicker)}</text>`);
  y += story ? 160 : 90;
  titleLines.forEach((line, i) => {
    parts.push(`<text x="${cx}" y="${y + i * titleSize * 1.12}" fill="#FFFFFF" font-size="${titleSize}" font-weight="800">${esc(line)}</text>`);
  });
  y += (titleLines.length - 1) * titleSize * 1.12 + (story ? 150 : 76);

  if (text.greeting) {
    const size = story ? 60 : 38;
    const lines = wrapWords(`«${text.greeting}»`, story ? 28 : 44, story ? 3 : 2);
    lines.forEach((line, i) => {
      parts.push(`<text x="${cx}" y="${y + i * size * 1.3}" fill="#FCE286" font-size="${size}" font-weight="600">${esc(line)}</text>`);
    });
    y += (lines.length - 1) * size * 1.3 + (story ? 76 : 50);
    if (text.author) {
      const name = clip(text.author.name, 28);
      const fs = story ? 34 : 26;
      const r = fs * 0.55;
      // Ширина тексту — оцінка (≈0.52 кегля на знак): прапор і ім’я разом посередині.
      const width = r * 2 + 12 + name.length * fs * 0.52;
      const x0 = cx - width / 2;
      parts.push(flagCircle(text.author.flagCode, x0 + r, y - fs * 0.35, r, flags, 'pa'));
      parts.push(`<text x="${x0 + r * 2 + 12}" y="${y}" fill="#B4B4BC" font-size="${fs}" font-weight="500" text-anchor="start">${esc(name)}</text>`);
    }
    y += story ? 150 : 80;
  } else {
    y += story ? 60 : 30;
  }

  // Імена — дві колонки.
  const people = text.people.slice(0, 10);
  const rows = Math.ceil(people.length / 2);
  const rowH = story ? 88 : 48;
  const colX = [frame + 90, cx + 30];
  const fs = story ? 40 : 28;
  const r = story ? 24 : 17;
  const maxChars = story ? 15 : 19;
  people.forEach((p, i) => {
    const x = colX[i % 2]!;
    const cy = y + Math.floor(i / 2) * rowH;
    parts.push(
      flagCircle(p.flagCode, x + r, cy, r, flags, `pf${i}`) +
        `<text x="${x + r * 2 + 16}" y="${cy + fs * 0.36}" fill="#ECECEF" font-size="${fs}" font-weight="600" text-anchor="start">${esc(clip(p.name, maxChars))} ${esc(p.emoji)}</text>`,
    );
  });
  const blockBottom = y + Math.max(0, rows - 1) * rowH + r;
  const blockTop = -34;
  const brandY = h - frame - (story ? 70 : 46);
  const top = frame + 60;
  const bottom = brandY - 60;
  const offset = top + Math.max(0, (bottom - top - (blockBottom - blockTop)) / 2) - blockTop;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D2846"/><stop offset="1" stop-color="#2B2440"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0" r="0.7"><stop offset="0" stop-color="#FCE286" stop-opacity="0.22"/><stop offset="1" stop-color="#FCE286" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
<rect width="${w}" height="${h}" fill="url(#glow)"/>
${sparks}
<rect x="${frame}" y="${frame}" width="${w - frame * 2}" height="${h - frame * 2}" rx="26" fill="none" stroke="#FCE286" stroke-width="5"/>
<g text-anchor="middle" ${font}>
<g transform="translate(0 ${offset.toFixed(1)})">
${parts.join('\n')}
</g>
<text x="${cx}" y="${brandY}" fill="#FCE286" font-size="32" font-weight="700">${esc(text.brand)}</text>
</g>
</svg>`;
}

/** Круглі прапори з `public/flags/round` як data-URL (для вбудовування в листівку). Невдалі — пропускаємо. */
export async function loadRoundFlags(codes: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(codes)].map(async (code) => {
      try {
        const file = code === 'un' ? 'un' : code.toLowerCase();
        const res = await fetch(`/flags/round/${file}.svg`);
        if (!res.ok) return;
        const svg = await res.text();
        out[code] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      } catch {
        // без мережі — сіре коло
      }
    }),
  );
  return out;
}
