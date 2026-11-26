/**
 * Картка «Запрошення на новорічну ніч» 1080×1920 (передстартовий сайт, рішення власника 2026-11-20; еталон —
 * `dashboard/data/country-kits/_compare/home-card-2/home-card-2-invite.png`, генератор еталона — `gen.py` поруч).
 * Малюється на canvas у браузері — і превʼю на сторінці, і PNG для поширення (той самий кадр). Координати й кольори —
 * з генератора еталона; тексти й змінні приходять ззовні, довгі рядки стискаються до своєї ширини, а не переносяться.
 * Без React; шрифт — сімейство сторінки (Manrope), його завантажує викликач.
 */
export const INVITE_W = 1080;
export const INVITE_H = 1920;

export interface InviteTexts {
  title1: string;
  title2: string;
  /** «НОВОРІЧНА НІЧ» — рік додається окремо червоним. */
  night: string;
  year: string;
  /** «26 годин · 38 півночей · увесь світ наживо». */
  tagline: string;
  /** Підписи шкали: «№1», «№38», «№22». */
  scaleFirst: string;
  scaleLast: string;
  scaleMine: string;
  mineLabel: string;
  /** «22-га» */
  ord: string;
  country: string;
  /** «1 січня, 00:00» */
  mineWhen: string;
  startLabel: string;
  /** «31 грудня, 12:00 · Київ» */
  startWhen: string;
  /** «Кірітіматі · перша північ» */
  startSub: string;
  /** «вхід вільний · » */
  free: string;
  site: string;
  sealTop: string;
  sealBottom: string;
  /** «38 півночей наживо — » (адреса сайту — окремо жовтим). */
  footer: string;
}

export interface InviteParams {
  texts: InviteTexts;
  /** Усього півночей (поясів) і номер моєї (1…total). */
  total: number;
  mine: number;
  /** Круглий прапор (уже завантажений) або `null`. */
  flag: CanvasImageSource | null;
  logo: CanvasImageSource | null;
  fontFamily: string;
}

const Y = '#FCE286';
const W = '#ECECEF';
const BG = '#121214';
const PAPER = '#EFE7D6';
const INK = '#2A2620';
const MUTE = '#8A8072';
const SUB = '#6A6254';
const RED = '#D93A41';
const FWC = ['#FCE286', '#E8837F', '#9FB4F0', '#8CC7C2', '#F2EBDD', '#D93A41'] as const;

type G = CanvasRenderingContext2D & { letterSpacing?: string };
type Paint = string | CanvasGradient;

const TW = 840;
const TH = 1180;

// ---------- дрібні примітиви ----------

function rrect(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function spacing(g: G, px: number) {
  if ('letterSpacing' in g) g.letterSpacing = `${px}px`;
}

/** Ширина рядка з поправкою на letter-spacing (якщо canvas його не вміє — додаємо руками не будемо: це лише вимір). */
function textW(g: G, s: string): number {
  return g.measureText(s).width;
}

/**
 * Шрифт із розміром, що не дає рядку вийти за `maxW`: від `size` вниз до `min` (рядок не переноситься й не
 * обрізається — так поводяться довгі назви країн).
 */
function fit(g: G, family: string, s: string, size: number, weight: number, maxW: number, min = size * 0.55): number {
  let px = size;
  for (;;) {
    g.font = `${weight} ${px}px ${family}`;
    if (textW(g, s) <= maxW || px <= min) return px;
    px = Math.max(min, px - 1);
  }
}

/** Тінь розмитої фігури (як `feGaussianBlur` еталона): малюємо фігуру поза кадром, у кадр падає лише її тінь. */
function blurredShadow(g: G, path: () => void, dx: number, dy: number, sd: number, alpha: number) {
  const m = g.getTransform();
  const far = 20000;
  g.save();
  g.setTransform(new DOMMatrix().translate(-far, 0).multiply(m));
  // Зсув тіні задається в координатах пристрою: повертаємо (dx, dy) так само, як повернуто фігуру.
  const ox = m.a * dx + m.c * dy;
  const oy = m.b * dx + m.d * dy;
  g.shadowColor = `rgba(0,0,0,${alpha})`;
  g.shadowBlur = sd * 2;
  g.shadowOffsetX = far + ox;
  g.shadowOffsetY = oy;
  g.fillStyle = '#000';
  path();
  g.fill();
  g.restore();
}

/** Салют еталона (`#bf`): віночок рисок, кільце крапок, серцевина. */
function burst(g: G, x: number, y: number, s: number, color: string) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'butt';
  g.setLineDash([1.4, 6.5]);
  g.lineWidth = 13;
  g.beginPath();
  g.arc(0, 0, 15, 0, Math.PI * 2);
  g.stroke();
  g.lineCap = 'round';
  g.setLineDash([0.1, 6.7]);
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(0, 0, 26, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.arc(0, 0, 2.6, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function spark(g: G, x: number, y: number, s: number, color: string) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = color;
  g.beginPath();
  const p = [0, -12, 2.6, -2.6, 12, 0, 2.6, 2.6, 0, 12, -2.6, 2.6, -12, 0, -2.6, -2.6];
  g.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i]!, p[i + 1]!);
  g.closePath();
  g.fill();
  g.restore();
}

function circle(g: G, x: number, y: number, r: number, fill: Paint) {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function line(g: G, x1: number, y1: number, x2: number, y2: number, color: string, w: number, cap: CanvasLineCap = 'butt') {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = cap;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function flagDisc(g: G, flag: CanvasImageSource | null, cx: number, cy: number, r: number) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  if (flag) g.drawImage(flag, cx - r, cy - r, 2 * r, 2 * r);
  else {
    g.fillStyle = '#B9AE9C';
    g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  g.restore();
}

/** Текст по дузі кола (`textPath` еталона): `top` — по верхній дузі назовні, інакше — по нижній, літерами до центру. */
function arcText(g: G, s: string, cx: number, cy: number, r: number, top: boolean, ls: number) {
  const chars = [...s];
  spacing(g, 0);
  const widths = chars.map((c) => textW(g, c) + ls);
  const total = widths.reduce((a, b) => a + b, 0);
  g.textAlign = 'center';
  let x = 0;
  chars.forEach((c, i) => {
    const w = widths[i]!;
    const mid = (x + (w - ls) / 2 - total / 2) / r;
    const a = top ? -Math.PI / 2 + mid : Math.PI / 2 - mid;
    g.save();
    g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a));
    g.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
    g.fillText(c, 0, 0);
    g.restore();
    x += w;
  });
  g.textAlign = 'left';
}

// ---------- сцена: збірне нічне місто (кешується) ----------

/** Дальній ряд будинків — рівно ті, що дав `random.Random(3)` генератора еталона. */
const BACK_ROW: readonly (readonly [number, number, number])[] = [
  [0, 37, 145], [41, 34, 117], [79, 45, 150], [128, 32, 147], [160, 56, 130], [218, 47, 99], [266, 52, 130], [322, 56, 140],
  [381, 42, 89], [424, 50, 89], [480, 46, 119], [531, 30, 78], [562, 54, 145], [616, 39, 73], [661, 57, 104], [721, 49, 119],
];

function drawCity(g: G) {
  const w = 760;
  const h = 340;
  const base = h - 70;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1B2142');
  sky.addColorStop(0.55, '#3E2B52');
  sky.addColorStop(1, '#6A3F5E');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.75;
  for (const [x, y, r] of [[40, 30, 2.2], [300, 22, 2], [420, 120, 1.6], [560, 40, 2], [760, 140, 1.8], [240, 170, 1.5], [690, 22, 1.6], [360, 70, 1.4]] as const)
    circle(g, x, y, r, '#F2EBDD');
  g.globalAlpha = 1;
  for (const [x, y, s, c] of [[300, 128, 1.6, '#F2D68A'], [480, 70, 1.35, '#E8837F'], [712, 74, 1.6, '#9FB4F0'], [548, 178, 0.75, '#8CC7C2'], [390, 168, 0.6, '#F2EBDD']] as const)
    burst(g, x, y, s, c);
  g.globalAlpha = 0.75;
  g.fillStyle = '#6E5480';
  for (const [x, bw, bh] of BACK_ROW) g.fillRect(x, base - bh, bw, bh);
  g.globalAlpha = 1;

  // оглядове колесо
  const L = '#C9B6D2';
  const cx = 128;
  const cy = base - 128;
  const R = 112;
  g.strokeStyle = L;
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx - 58, base);
  g.moveTo(cx, cy);
  g.lineTo(cx + 58, base);
  g.stroke();
  g.lineCap = 'butt';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(cx, cy, R - 12, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    g.moveTo(cx, cy);
    g.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
  }
  g.stroke();
  circle(g, cx, cy, 10, L);
  const cab = ['#E8837F', '#FCE286', '#8CC7C2', '#9FB4F0'];
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    g.fillStyle = cab[i % 4]!;
    rrect(g, cx + R * Math.cos(a) - 9, cy + R * Math.sin(a) - 2, 18, 16, 4);
    g.fill();
  }

  const F = '#A08AB2';
  const WIN = '#7E6894';
  const LIT = '#F2D27A';
  const rect = (x: number, y: number, rw: number, rh: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, rw, rh);
  };
  const tower = (x: number, y0: number, bw: number, bh: number, litEvery: number) => {
    rect(x, y0, bw, bh, F);
    let k = 0;
    for (let yy = y0 + 14; yy < base - 14; yy += 22)
      for (let xx = x + 9; xx < x + bw - 14; xx += 18) {
        k += 1;
        rect(xx, yy, 9, 11, k % litEvery === 0 ? LIT : WIN);
      }
  };
  // купол
  rect(270, base - 82, 130, 82, F);
  rect(296, base - 108, 78, 26, '#B7A2C4');
  g.fillStyle = L;
  g.beginPath();
  g.arc(335, base - 108, 39, Math.PI, 0);
  g.closePath();
  g.fill();
  line(g, 335, base - 147, 335, base - 172, L, 4);
  circle(g, 335, base - 176, 5, LIT);
  for (let x = 282; x < 396; x += 18) rect(x, base - 70, 8, 58, WIN);
  tower(410, base - 190, 64, 190, 2);
  rect(420, base - 206, 44, 16, F);
  line(g, 442, base - 206, 442, base - 236, F, 4);
  tower(478, base - 120, 56, 120, 3);
  // безіменний хмарочос зі шпилем
  const tx = 596;
  const S = '#B7A2C4';
  rect(tx - 24, base - 200, 48, 200, S);
  rect(tx - 17, base - 232, 34, 32, S);
  rect(tx - 10, base - 256, 20, 24, S);
  g.fillStyle = '#E8837F';
  g.beginPath();
  g.moveTo(tx - 10, base - 256);
  g.lineTo(tx, base - 290);
  g.lineTo(tx + 10, base - 256);
  g.closePath();
  g.fill();
  line(g, tx, base - 290, tx, base - 322, S, 3);
  circle(g, tx, base - 324, 5, RED);
  for (let yy = base - 190; yy < base - 14; yy += 20)
    for (let j = 0; j < 3; j++) rect(tx - 16 + j * 12, yy, 7, 10, (j + Math.floor(yy / 20)) % 3 === 0 ? LIT : WIN);
  tower(538, base - 96, 44, 96, 2);
  tower(630, base - 170, 60, 170, 3);
  g.fillStyle = F;
  g.beginPath();
  g.moveTo(640, base - 170);
  g.lineTo(660, base - 200);
  g.lineTo(680, base - 170);
  g.closePath();
  g.fill();
  tower(694, base - 110, 62, 110, 2);
  tower(240, base - 70, 34, 70, 2);
  tower(0, base - 60, 40, 60, 2);
  rect(0, base, w, h - base, '#262042');
  g.globalAlpha = 0.6;
  for (const [x, dy, ln, c] of [[110, 18, 70, L], [300, 30, 90, '#F2D68A'], [420, 20, 60, '#E8837F'], [560, 40, 70, '#9FB4F0'], [680, 26, 54, '#F2D68A'], [150, 46, 50, '#8CC7C2'], [470, 50, 44, '#F2D68A']] as const) {
    g.fillStyle = c;
    rrect(g, x, base + dy, ln, 5, 2.5);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Зерно паперу (`feTurbulence` еталона): дрібний теплий шум із прозорістю 0…0,15. */
function paperNoise(): HTMLCanvasElement | null {
  const cv = document.createElement('canvas');
  cv.width = TW;
  cv.height = TH;
  const g = cv.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(TW, TH);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() + rnd() + rnd()) / 3; // ≈ нормальний розподіл довкола 0,5
    const a = 0.5 * Math.max(0, 0.55 * n - 0.231); // еталон рендерить зерно мʼякше за білий шум — половина прозорості
    d[i] = 107;
    d[i + 1] = 87;
    d[i + 2] = 61;
    d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return cv;
}

let cache: { city: HTMLCanvasElement; noise: HTMLCanvasElement | null } | null = null;
function statics() {
  if (cache) return cache;
  const city = document.createElement('canvas');
  city.width = 760;
  city.height = 340;
  const cg = city.getContext('2d') as G | null;
  if (cg) drawCity(cg);
  cache = { city, noise: paperNoise() };
  return cache;
}

// ---------- печатка ----------

function waxPath(g: G, cx: number, cy: number, R: number) {
  g.beginPath();
  for (let k = 0; k <= 180; k++) {
    const a = (k * 2 * Math.PI) / 180;
    const r = R * (1 + 0.035 * Math.sin(7 * a) + 0.022 * Math.sin(13 * a + 1) + 0.015 * Math.sin(23 * a + 2));
    if (k === 0) g.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    else g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  g.closePath();
}

function wax(g: G, cx: number, cy: number, R: number, p: InviteParams) {
  blurredShadow(g, () => waxPath(g, cx + 10, cy + 18, R), 0, 0, 22, 0.55);
  const grad = g.createRadialGradient(cx - 0.24 * R, cy - 0.36 * R, 0, cx - 0.24 * R, cy - 0.36 * R, 1.5 * R);
  grad.addColorStop(0, '#E9545A');
  grad.addColorStop(0.6, '#C02E36');
  grad.addColorStop(1, '#8E1C24');
  waxPath(g, cx, cy, R);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = '#7A141B';
  g.beginPath();
  g.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.6;
  g.lineWidth = 2;
  g.strokeStyle = '#F58A8E';
  g.beginPath();
  g.arc(cx - 1.5, cy - 1.5, R * 0.66, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;

  const fs = Math.round(R * 0.15);
  const { sealTop, sealBottom } = p.texts;
  // Нижній напис довший за верхній: якщо не влазить у півколо — дрібніший шрифт.
  const fsB = fit(g, p.fontFamily, sealBottom, fs, 800, Math.PI * R * 0.915 * 0.8, fs * 0.7);
  const fsT = fit(g, p.fontFamily, sealTop, fs, 800, Math.PI * R * 0.79 * 0.8, fs * 0.7);
  for (const [col, d] of [['#7A141B', 1.6], ['#FFE1DD', 0]] as const) {
    g.fillStyle = col;
    g.font = `800 ${fsT}px ${p.fontFamily}`;
    arcText(g, sealTop, cx + d, cy + d, R * 0.79, true, 3);
    g.font = `800 ${fsB}px ${p.fontFamily}`;
    arcText(g, sealBottom, cx + d, cy + d, R * 0.915, false, 3);
    for (const sx of [-1, 1]) circle(g, cx + sx * R * 0.855 + d, cy + d, R * 0.03, col);
  }
  // глобус
  for (const [col, d] of [['#7A141B', 1.5], ['#FFE1DD', 0]] as const) {
    g.save();
    g.translate(cx - R * 0.21 + d, cy - R * 0.6 + d);
    g.scale(R * 0.0105, R * 0.0105);
    g.strokeStyle = col;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(20, 20, 13, 0, Math.PI * 2);
    g.moveTo(26, 20);
    g.ellipse(20, 20, 6, 13, 0, 0, Math.PI * 2);
    g.moveTo(20, 7);
    g.lineTo(20, 33);
    g.moveTo(7, 20);
    g.lineTo(33, 20);
    g.moveTo(8.7, 13.5);
    g.lineTo(31.3, 13.5);
    g.moveTo(8.7, 26.5);
    g.lineTo(31.3, 26.5);
    g.stroke();
    g.restore();
  }
  g.font = `800 ${Math.round(R * 0.4)}px ${p.fontFamily}`;
  g.textAlign = 'center';
  g.fillStyle = '#7A141B';
  g.fillText(p.texts.year, cx + 1.5, cy + R * 0.36 + 1.5);
  g.fillStyle = '#FFE1DD';
  g.fillText(p.texts.year, cx, cy + R * 0.36);
  g.textAlign = 'left';
}

// ---------- кадр ----------

/** Намалювати картку в контекст 1080×1920 (превʼю й PNG — той самий кадр). */
export function drawInvite(ctx: CanvasRenderingContext2D, p: InviteParams) {
  const g = ctx as G;
  const fam = p.fontFamily;
  const t = p.texts;
  const st = statics();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillStyle = BG;
  g.fillRect(0, 0, INVITE_W, INVITE_H);

  // сяйво за карткою
  g.save();
  g.translate(540, 1010);
  g.scale(1, 720 / 620);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 620);
  glow.addColorStop(0, 'rgba(106,63,94,0.75)');
  glow.addColorStop(1, 'rgba(106,63,94,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, 620, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.globalAlpha = 0.85;
  for (const [x, y, s, c] of [[78, 70, 1.5, FWC[1]], [1004, 66, 1.5, FWC[2]], [70, 470, 1.7, FWC[0]], [1000, 520, 2.0, FWC[3]], [80, 900, 2.2, FWC[2]], [1000, 960, 2.3, FWC[1]], [75, 1330, 1.9, FWC[3]], [980, 1820, 2.4, FWC[2]], [560, 1880, 1.4, FWC[1]], [760, 1860, 1.0, FWC[4]]] as const)
    burst(g, x, y, s, c);
  g.globalAlpha = 1;
  for (const [x, y, s, c] of [[205, 70, 1.1, Y], [960, 250, 0.9, Y], [150, 640, 0.8, W], [960, 760, 1.0, Y], [120, 1180, 0.9, Y], [180, 1660, 1.0, Y], [1010, 1660, 0.9, W]] as const)
    spark(g, x, y, s, c);

  // заголовок
  spacing(g, 0);
  g.textAlign = 'center';
  g.fillStyle = W;
  g.font = `800 ${fit(g, fam, t.title1, 124, 800, 980)}px ${fam}`;
  g.fillText(t.title1, 540, 214);
  g.fillStyle = Y;
  g.font = `800 ${fit(g, fam, t.title2, 90, 800, 980)}px ${fam}`;
  g.fillText(t.title2, 540, 330);
  g.textAlign = 'left';

  // конверт за карткою
  const EW = 930;
  const EH = 600;
  g.save();
  g.translate(548, 1318);
  g.rotate((5 * Math.PI) / 180);
  g.translate(-EW / 2, -EH / 2);
  blurredShadow(g, () => rrect(g, 14, 28, EW, EH, 18), 0, 0, 22, 0.6);
  const env = g.createLinearGradient(0, 0, 0, EH);
  env.addColorStop(0, '#7E68B4');
  env.addColorStop(1, '#5A4894');
  g.fillStyle = env;
  rrect(g, 0, 0, EW, EH, 18);
  g.fill();
  g.globalAlpha = 0.55;
  g.fillStyle = '#5A4894';
  g.beginPath();
  g.moveTo(0, 18);
  g.lineTo(EW / 2, EH * 0.5);
  g.lineTo(0, EH - 18);
  g.closePath();
  g.moveTo(EW, 18);
  g.lineTo(EW / 2, EH * 0.5);
  g.lineTo(EW, EH - 18);
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
  const envb = g.createLinearGradient(0, EH * 0.42, 0, EH);
  envb.addColorStop(0, '#9A86C8');
  envb.addColorStop(1, '#7A64B0');
  g.fillStyle = envb;
  g.beginPath();
  g.moveTo(0, EH);
  g.lineTo(EW / 2, EH * 0.42);
  g.lineTo(EW, EH);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.75;
  g.strokeStyle = '#C9B6D2';
  g.lineWidth = 3;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  g.beginPath();
  g.moveTo(10, EH - 8);
  g.lineTo(EW / 2, EH * 0.42);
  g.lineTo(EW - 10, EH - 8);
  g.moveTo(10, 10);
  g.lineTo(EW / 2, EH * 0.5);
  g.lineTo(EW - 10, 10);
  g.stroke();
  g.globalAlpha = 0.8;
  g.lineWidth = 2.5;
  rrect(g, 2, 2, EW - 4, EH - 4, 16);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();

  // картка
  g.save();
  g.translate(540, 1000);
  g.rotate((-3.5 * Math.PI) / 180);
  g.translate(-TW / 2, -TH / 2);
  blurredShadow(g, () => rrect(g, 16, 30, TW, TH, 26), 0, 0, 22, 0.7);
  g.fillStyle = PAPER;
  rrect(g, 0, 0, TW, TH, 26);
  g.fill();
  g.save();
  rrect(g, 0, 0, TW, TH, 26);
  g.clip();
  if (st.noise) g.drawImage(st.noise, 0, 0);
  g.save();
  g.scale(TW, TH);
  const sheen = g.createLinearGradient(0, 0, 1, 1);
  sheen.addColorStop(0, 'rgba(255,255,255,0.35)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(90,74,48,0.12)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, 1, 1);
  g.restore();
  g.restore();
  g.strokeStyle = '#B9A57C';
  g.lineWidth = 2.5;
  rrect(g, 18, 18, TW - 36, TH - 36, 14);
  g.stroke();
  g.strokeStyle = '#CFC2A4';
  g.lineWidth = 1.2;
  rrect(g, 26, 26, TW - 52, TH - 52, 10);
  g.stroke();
  g.save();
  rrect(g, 40, 40, 760, 340, 12);
  g.clip();
  g.drawImage(st.city, 40, 40);
  g.restore();

  // «НОВОРІЧНА НІЧ 2027»
  spacing(g, 1);
  const headPx = fit(g, fam, `${t.night} ${t.year}`, 60, 800, 720);
  g.font = `800 ${headPx}px ${fam}`;
  const wNight = textW(g, `${t.night} `);
  const wYear = textW(g, t.year);
  let hx = 420 - (wNight + wYear) / 2;
  g.fillStyle = INK;
  g.fillText(`${t.night} `, hx, 458);
  hx += wNight;
  g.fillStyle = RED;
  g.fillText(t.year, hx, 458);
  spacing(g, 0);
  g.textAlign = 'center';
  g.fillStyle = SUB;
  g.font = `700 ${fit(g, fam, t.tagline, 28, 700, 720)}px ${fam}`;
  g.fillText(t.tagline, 420, 506);
  g.textAlign = 'left';

  // шкала півночей
  const N = Math.max(2, p.total);
  const ME = Math.min(Math.max(1, p.mine), N);
  const x0 = 70;
  const x1 = 770;
  const ry = 584;
  const dx = (x1 - x0) / (N - 1);
  const mx = x0 + (ME - 1) * dx;
  line(g, x0, ry, x1, ry, '#B9AE9C', 5, 'round');
  if (ME > 1) line(g, x0, ry, mx, ry, RED, 5, 'round');
  for (let i = 1; i <= N; i++) {
    if (i === ME) continue;
    const x = x0 + (i - 1) * dx;
    if (i === 1 || i === N) {
      circle(g, x, ry, 11, PAPER);
      g.strokeStyle = i === 1 ? RED : SUB;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(x, ry, 11, 0, Math.PI * 2);
      g.stroke();
    } else circle(g, x, ry, 5.5, i < ME ? RED : MUTE);
  }
  circle(g, mx, ry, 37, INK);
  flagDisc(g, p.flag, mx, ry, 30);
  g.font = `800 28px ${fam}`;
  const wMine = textW(g, t.scaleMine);
  g.font = `700 24px ${fam}`;
  const wFirst = textW(g, t.scaleFirst);
  const wLast = textW(g, t.scaleLast);
  g.fillStyle = MUTE;
  // Підписи кінців ховаються, коли на них наїжджає підпис моєї півночі (перша, друга, передостання…).
  if (mx - wMine / 2 > x0 - 6 + wFirst + 8) g.fillText(t.scaleFirst, x0 - 6, ry + 52);
  if (mx + wMine / 2 < x1 + 6 - wLast - 8) {
    g.textAlign = 'right';
    g.fillText(t.scaleLast, x1 + 6, ry + 52);
  }
  g.textAlign = 'center';
  g.fillStyle = RED;
  g.font = `800 28px ${fam}`;
  g.fillText(t.scaleMine, Math.min(Math.max(mx, x0 - 6 + wMine / 2), x1 + 6 - wMine / 2), ry + 72);
  g.textAlign = 'left';
  g.save();
  g.setLineDash([2, 8]);
  line(g, 56, 684, TW - 56, 684, '#CFC4AE', 2, 'round');
  g.restore();

  const label = (y: number, s: string) => {
    g.font = `700 24px ${fam}`;
    spacing(g, 2.5);
    g.fillStyle = MUTE;
    g.fillText(s, 56, y);
    spacing(g, 0);
  };

  // «Моя північ»: «22-га · ⬤ Україна». Довга назва спершу зменшує рядок (до 34 px), далі переноситься на другий
  // рядок під саму назву (найдовші — «Південна Джорджія та Південні Сандвічеві Острови»); слова не рвуться.
  const ordPart = `${t.ord} · `;
  const rowMax = TW - 56 - 56;
  const layoutRow = (px: number) => {
    g.font = `800 ${px}px ${fam}`;
    const fr = 22 * (px / 48);
    const cx = 56 + textW(g, ordPart) + 2 * fr + 12;
    return { fr, cx, avail: 56 + rowMax - cx };
  };
  let rowPx = 48;
  let lines: string[] = [t.country];
  for (;;) {
    const { avail } = layoutRow(rowPx);
    if (textW(g, t.country) <= avail) break;
    if (rowPx > 34) {
      rowPx -= 1;
      continue;
    }
    // перенос: два рядки якомога рівніші; коротке службове слово («в», «de», «du») не лишається в кінці рядка
    const words = t.country.split(' ');
    let best: [string, string] | null = null;
    let bestW = Infinity;
    for (let i = 1; i < words.length; i++) {
      if (words[i - 1]!.length <= 2 && i > 1) continue;
      const l1 = words.slice(0, i).join(' ');
      const l2 = words.slice(i).join(' ');
      const w = Math.max(textW(g, l1), textW(g, l2));
      if (w <= avail && w < bestW) {
        best = [l1, l2];
        bestW = w;
      }
    }
    if (best || rowPx <= 24) {
      lines = best ?? [t.country];
      break;
    }
    rowPx -= 1;
  }
  const { fr, cx: countryX } = layoutRow(rowPx);
  const k = rowPx / 48;
  const two = lines.length > 1;
  const rowY = two ? 782 : 796;
  const lineH = Math.round(rowPx * 1.12);
  g.font = `800 ${rowPx}px ${fam}`;
  const rowRight = countryX + Math.max(...lines.map((l) => textW(g, l)));
  // Дрібні салюти праворуч від блоку — лише там, де вони не під текстом.
  for (const [x, y, s, c] of [[690, 790, 1.7, '#E8837F'], [586, 736, 0.9, '#9FB4F0'], [770, 712, 0.7, '#E8C872']] as const)
    if (x - 27 * s > rowRight + 10 || y + 27 * s < 740) burst(g, x, y, s, c);
  label(738, t.mineLabel);
  g.font = `800 ${rowPx}px ${fam}`;
  g.fillStyle = INK;
  g.fillText(ordPart, 56, rowY);
  flagDisc(g, p.flag, countryX - 12 - fr, rowY - 17 * k, fr);
  lines.forEach((l, i) => g.fillText(l, countryX, rowY + i * lineH));
  g.font = `700 ${two ? 34 : 38}px ${fam}`;
  g.fillText(t.mineWhen, 56, two ? rowY + lineH + 46 : 846);

  // «Початок» — до печатки праворуч.
  label(912, t.startLabel);
  g.fillStyle = INK;
  g.font = `800 ${fit(g, fam, t.startWhen, 36, 800, 470)}px ${fam}`;
  g.fillText(t.startWhen, 56, 962);
  g.fillStyle = SUB;
  g.font = `700 ${fit(g, fam, t.startSub, 28, 700, 500)}px ${fam}`;
  g.fillText(t.startSub, 56, 1004);

  const freePx = fit(g, fam, t.free + t.site, 26, 700, 450);
  g.font = `700 ${freePx}px ${fam}`;
  g.fillStyle = MUTE;
  g.fillText(t.free, 56, 1126);
  const wFree = textW(g, t.free);
  g.fillStyle = INK;
  g.fillText(t.site, 56 + wFree, 1126);

  wax(g, 680, 1076, 160, p);
  g.restore();

  // гачок і логотип
  let footPx = 50;
  for (;;) {
    g.font = `700 ${footPx}px ${fam}`;
    const a = textW(g, t.footer);
    g.font = `800 ${footPx}px ${fam}`;
    if (a + textW(g, t.site) <= 980 || footPx <= 30) break;
    footPx -= 1;
  }
  g.font = `700 ${footPx}px ${fam}`;
  const wa = textW(g, t.footer);
  g.font = `800 ${footPx}px ${fam}`;
  const wb = textW(g, t.site);
  const fx0 = 540 - (wa + wb) / 2;
  g.font = `700 ${footPx}px ${fam}`;
  g.fillStyle = W;
  g.fillText(t.footer, fx0, 1742);
  g.font = `800 ${footPx}px ${fam}`;
  g.fillStyle = Y;
  g.fillText(t.site, fx0 + wa, 1742);
  if (p.logo) g.drawImage(p.logo, 90, 1790, 300, 86);
  g.restore();
}

/**
 * Суфікс українського порядкового жіночого роду для «північ»: 1-ша, 2-га, 3-тя, 7-ма, 8-ма, решта -та
 * (11…19 — -та: «одинадцята», «сімнадцята»).
 */
export function ukOrdinalFemSuffix(n: number): 'sha' | 'ga' | 'tya' | 'ma' | 'ta' {
  const t = n % 100;
  if (t >= 11 && t <= 19) return 'ta';
  switch (n % 10) {
    case 1:
      return 'sha';
    case 2:
      return 'ga';
    case 3:
      return 'tya';
    case 7:
    case 8:
      return 'ma';
    default:
      return 'ta';
  }
}

/** Скільки годин іде північ світом (перша → остання), ціле. */
export function nightHours(firstMidnightMs: number, lastMidnightMs: number): number {
  return Math.round((lastMidnightMs - firstMidnightMs) / 3_600_000);
}

/** PNG кадру 1080×1920. */
export function renderInvitePng(p: InviteParams): Promise<Blob | null> {
  const cv = document.createElement('canvas');
  cv.width = INVITE_W;
  cv.height = INVITE_H;
  const g = cv.getContext('2d');
  if (!g) return Promise.resolve(null);
  drawInvite(g, p);
  return new Promise((resolve) => cv.toBlob((b) => resolve(b), 'image/png'));
}
