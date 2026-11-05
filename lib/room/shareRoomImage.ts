/**
 * Картка «Поділитися кімнатою» (власник 2026-11-05): той самий стиль і формати, що й картка штампа
 * (`lib/offers/shareImage.ts`, 9:16 і 1:1), але замість міста — сітка кімнати: місто й час півночі кожного вікна.
 * Кадрів YouTube у картці немає (чужі кадри в зображення для поширення не вставляємо).
 */
import { SHARE_SIZE, type ShareRatio } from '@/lib/offers/shareImage';

export interface RoomShareCell {
  city: string;
  /** «02:00» за часом гостя. */
  time: string;
}

export interface RoomShareText {
  /** «КІМНАТА ПЕРЕГЛЯДУ». */
  eyebrow: string;
  /** «4 міста опівночі одночасно». */
  title: string;
  /** «Дивись зі мною — відкриється та сама кімната». */
  caption: string;
  brand: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function roomShareSvg(
  ratio: ShareRatio,
  cells: readonly RoomShareCell[],
  text: RoomShareText,
): string {
  const { w, h } = SHARE_SIZE[ratio];
  const cx = w / 2;
  const frame = 56;
  const font = 'font-family="Manrope, \'Segoe UI\', Arial, sans-serif"';
  const story = ratio === 'story';
  const top = story ? h * 0.24 : h * 0.16;
  const cols = cells.length === 1 ? 1 : 2;
  const gap = 28;
  const gridW = w - 2 * 140;
  const cw = (gridW - gap * (cols - 1)) / cols;
  const ch = story ? 230 : 170;
  const gy = top + (story ? 260 : 190);
  const tiles = cells
    .slice(0, 4)
    .map((c, i) => {
      const x = 140 + (i % cols) * (cw + gap);
      const y = gy + Math.floor(i / cols) * (ch + gap);
      return (
        `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="22" fill="#FFFFFF" fill-opacity="0.06" stroke="#E8C872" stroke-opacity="0.45" stroke-width="3"/>` +
        `<text x="${x + cw / 2}" y="${y + ch / 2 - 6}" fill="#FFFFFF" font-size="${story ? 50 : 42}" font-weight="800">${esc(c.city)}</text>` +
        `<text x="${x + cw / 2}" y="${y + ch / 2 + (story ? 56 : 46)}" fill="#E8C872" font-size="${story ? 40 : 34}" font-weight="800">${esc(c.time)}</text>`
      );
    })
    .join('');
  const rows = Math.ceil(Math.min(cells.length, 4) / cols);
  const capY = gy + rows * (ch + gap) + (story ? 70 : 40);
  const dots = [
    [220, h * 0.12, '#E8C872'],
    [860, h * 0.09, '#8CC7C2'],
    [940, h * 0.2, '#E8837F'],
  ]
    .map(
      ([x, y, c]) =>
        `<circle cx="${x}" cy="${y}" r="46" fill="none" stroke="${c}" stroke-width="6" stroke-dasharray="4 14" stroke-linecap="round"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1D2846"/><stop offset="1" stop-color="#4A4262"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#sky)"/>
${dots}
<rect x="${frame}" y="${frame}" width="${w - frame * 2}" height="${h - frame * 2}" rx="28" fill="none" stroke="#EFE7D6" stroke-width="6"/>
<g text-anchor="middle" ${font}>
<text x="${cx}" y="${top}" fill="#E8C872" font-size="40" font-weight="800" letter-spacing="8">${esc(text.eyebrow)}</text>
<text x="${cx}" y="${top + 110}" fill="#FFFFFF" font-size="${story ? 84 : 72}" font-weight="800">${esc(text.title)}</text>
${tiles}
<text x="${cx}" y="${capY}" fill="#ECECEF" font-size="38" font-weight="500">${esc(text.caption)}</text>
<text x="${cx}" y="${h - frame - 48}" fill="#EFE7D6" font-size="44" font-weight="700">${esc(text.brand)}</text>
</g>
</svg>`;
}
