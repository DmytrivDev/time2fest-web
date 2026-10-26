/**
 * Листівка країни та штемпель (C14, C20 CountdownScene). Ілюстрації намальовано в SVG за мотивами артбордів
 * Phone-Moment / Phone-Home-NoStream: небо, феєрверки, силует міста. Для країн без власної листівки
 * (`postcard-template`) — шаблон з палітрою, що залежить від `illustrationId`.
 *
 * Єдиний виняток із «лише токени» (eslint.config.mjs): художні кольори ілюстрацій задано прямо в SVG.
 * Alt штампа = текст штампа (`stampText`).
 */
import { useId, type CSSProperties, type ReactNode } from 'react';

export interface PostcardArtProps {
  /** `au-postcard`, `gb-postcard`, `fr-postcard`, `postcard-template` або будь-який інший id (шаблон). */
  illustrationId: string;
  className?: string;
  /** Якщо задано — SVG `role="img"` з цією назвою; інакше декоративний. */
  label?: string;
  /** Заповнити контейнер (сцена відліку) замість збереження пропорцій 3:2. */
  fill?: boolean;
}

interface Palette {
  skyTop: string;
  skyBottom: string;
  water: string;
  silhouette: string;
  fw: [string, string, string];
}

const PALETTES: Palette[] = [
  { skyTop: '#1D2846', skyBottom: '#4A4262', water: '#20364A', silhouette: '#8A93A8', fw: ['#E8C872', '#E8837F', '#8CC7C2'] },
  { skyTop: '#10162E', skyBottom: '#3B3A66', water: '#1A2A44', silhouette: '#7E86A6', fw: ['#F2D68A', '#9FB4F0', '#E8837F'] },
  { skyTop: '#151A36', skyBottom: '#53406A', water: '#232F52', silhouette: '#9189AE', fw: ['#E8C872', '#C79CEB', '#8CC7C2'] },
  { skyTop: '#142B3A', skyBottom: '#38546A', water: '#173244', silhouette: '#7D97A8', fw: ['#F2D68A', '#8CC7C2', '#E8837F'] },
  { skyTop: '#2A1D3C', skyBottom: '#6A3F5E', water: '#2A2444', silhouette: '#A58BA6', fw: ['#F2D68A', '#E8837F', '#9FB4F0'] },
  { skyTop: '#112A2E', skyBottom: '#2F5A5A', water: '#143C44', silhouette: '#7DA3A0', fw: ['#E8C872', '#E8837F', '#C79CEB'] },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function paletteOf(id: string): Palette {
  return PALETTES[hash(id) % PALETTES.length] ?? PALETTES[0]!;
}

const STARS = (
  <g fill="#F2EBDD" opacity="0.75">
    <circle cx="18" cy="20" r="1.1" />
    <circle cx="46" cy="84" r="0.9" />
    <circle cx="112" cy="14" r="1.2" />
    <circle cx="176" cy="70" r="0.9" />
    <circle cx="128" cy="96" r="0.8" />
    <circle cx="230" cy="104" r="0.9" />
    <circle cx="272" cy="30" r="1" />
  </g>
);

function Firework({ id, x, y, scale, color }: { id: string; x: number; y: number; scale: number; color: string }) {
  return <use href={`#${id}-fw`} transform={`translate(${x} ${y}) scale(${scale})`} style={{ color }} />;
}

function Scene({ id, children, pal }: { id: string; children: ReactNode; pal: Palette }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.skyTop} />
          <stop offset="1" stopColor={pal.skyBottom} />
        </linearGradient>
        <g id={`${id}-fw`}>
          <circle r="15" fill="none" stroke="currentColor" strokeWidth="13" strokeDasharray="1.4 6.5" />
          <circle r="26" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="0.1 6.7" />
          <circle r="2.6" fill="currentColor" />
        </g>
      </defs>
      <rect width="300" height="200" fill={`url(#${id}-sky)`} />
      {STARS}
      {children}
    </>
  );
}

function Water({ pal }: { pal: Palette }) {
  return (
    <>
      <rect y="148" width="300" height="52" fill={pal.water} />
      <g strokeLinecap="round" strokeWidth="2" opacity="0.55">
        <path d="M48 162 h22 M54 172 h14 M60 182 h8" stroke={pal.fw[0]} />
        <path d="M132 160 h20 M138 170 h12" stroke={pal.fw[1]} />
        <path d="M222 164 h26 M228 175 h14 M232 186 h8" stroke={pal.fw[2]} />
      </g>
    </>
  );
}

function Sydney({ id, pal }: { id: string; pal: Palette }) {
  return (
    <Scene id={id} pal={pal}>
      <Firework id={id} x={62} y={46} scale={0.9} color={pal.fw[0]} />
      <Firework id={id} x={146} y={40} scale={0.75} color={pal.fw[1]} />
      <Firework id={id} x={236} y={96} scale={0.7} color={pal.fw[2]} />
      <Firework id={id} x={110} y={18} scale={0.4} color={pal.fw[0]} />
      <Water pal={pal} />
      <g fill={pal.silhouette}>
        <rect x="150" y="112" width="12" height="38" />
        <rect x="282" y="112" width="12" height="38" />
      </g>
      <path d="M162 134 Q222 70 282 134" fill="none" stroke="#9AA3B8" strokeWidth="5" />
      <path d="M162 134 Q222 86 282 134" fill="none" stroke="#9AA3B8" strokeWidth="2" />
      <path d="M182 117 V134 M202 106 V134 M222 102 V134 M242 106 V134 M262 117 V134" stroke="#9AA3B8" strokeWidth="1.2" />
      <path d="M138 134 H300" stroke="#B4BBCB" strokeWidth="3.5" />
      <rect x="18" y="140" width="116" height="10" fill="#B9AE9C" />
      <path d="M26 140 Q38 104 66 95 Q58 118 62 140 Z" fill="#EFE7D8" />
      <path d="M56 140 Q70 97 100 86 Q90 113 96 140 Z" fill="#F6F0E4" />
      <path d="M90 140 Q102 112 124 106 Q117 124 122 140 Z" fill="#E4DACA" />
    </Scene>
  );
}

function London({ id, pal }: { id: string; pal: Palette }) {
  return (
    <Scene id={id} pal={pal}>
      <Firework id={id} x={210} y={52} scale={0.9} color={pal.fw[0]} />
      <Firework id={id} x={120} y={34} scale={0.65} color={pal.fw[1]} />
      <Firework id={id} x={268} y={110} scale={0.55} color={pal.fw[2]} />
      <Water pal={pal} />
      <rect x="0" y="140" width="300" height="10" fill={pal.silhouette} opacity="0.7" />
      <g fill="#A89F8C">
        <rect x="52" y="64" width="30" height="86" />
        <path d="M52 64 L67 22 L82 64 Z" fill="#8F8672" />
        <rect x="46" y="58" width="42" height="8" />
        <rect x="84" y="110" width="70" height="40" opacity="0.85" />
      </g>
      <circle cx="67" cy="84" r="9" fill="#EFE7D8" />
      <path d="M67 78 V84 L72 86" stroke="#4A4262" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M56 104 h22 M56 116 h22 M56 128 h22" stroke="#8F8672" strokeWidth="1.4" />
    </Scene>
  );
}

function Paris({ id, pal }: { id: string; pal: Palette }) {
  return (
    <Scene id={id} pal={pal}>
      <Firework id={id} x={70} y={50} scale={0.85} color={pal.fw[0]} />
      <Firework id={id} x={238} y={64} scale={0.8} color={pal.fw[1]} />
      <Firework id={id} x={196} y={18} scale={0.4} color={pal.fw[2]} />
      <Water pal={pal} />
      <rect x="0" y="140" width="300" height="10" fill={pal.silhouette} opacity="0.7" />
      <g fill="none" stroke="#C9B38A" strokeWidth="3" strokeLinejoin="round">
        <path d="M150 28 L132 142 M150 28 L168 142" />
        <path d="M138 98 H162 M143 70 H157" strokeWidth="2.5" />
        <path d="M128 142 Q150 112 172 142" />
        <path d="M150 28 V18" strokeWidth="2" />
      </g>
    </Scene>
  );
}

function Template({ id, pal, seed }: { id: string; pal: Palette; seed: number }) {
  const towers = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const w = 22 + ((seed >> (i * 2)) % 18);
    const h = 34 + ((seed >> (i + 3)) % 46);
    return { x: 6 + i * 36, w, h };
  });
  return (
    <Scene id={id} pal={pal}>
      <Firework id={id} x={74} y={48} scale={0.85} color={pal.fw[0]} />
      <Firework id={id} x={170} y={36} scale={0.75} color={pal.fw[1]} />
      <Firework id={id} x={248} y={86} scale={0.65} color={pal.fw[2]} />
      <Water pal={pal} />
      <g fill={pal.silhouette}>
        {towers.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={150 - b.h} width={b.w} height={b.h} />
            <rect x={b.x + 4} y={150 - b.h + 6} width="3" height="3" fill="#FCE286" opacity="0.8" />
            <rect x={b.x + b.w - 8} y={150 - b.h + 14} width="3" height="3" fill="#FCE286" opacity="0.8" />
          </g>
        ))}
      </g>
    </Scene>
  );
}

/** Листівка 3:2 без штемпеля. Декоративна, якщо немає `label`. */
export function PostcardArt({ illustrationId, className, label, fill = false }: PostcardArtProps) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = `pc${raw}`;
  const key = illustrationId.toLowerCase();
  let scene: ReactNode;
  if (key === 'au-postcard') scene = <Sydney id={id} pal={PALETTES[0]!} />;
  else if (key === 'gb-postcard') scene = <London id={id} pal={PALETTES[1]!} />;
  else if (key === 'fr-postcard') scene = <Paris id={id} pal={PALETTES[2]!} />;
  else scene = <Template id={id} pal={paletteOf(key)} seed={hash(key)} />;
  return (
    <svg
      viewBox="0 0 300 200"
      preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-illustration={illustrationId}
    >
      {scene}
    </svg>
  );
}

export interface StampMarkProps {
  /** Текст по дузі: «НОВИЙ РІК 2027 · СІДНЕЙ». */
  text: string;
  date?: string;
  time?: string;
  className?: string;
  /** Клас, яким CSS запускає «удар» (лише у `lively`). */
  hitClassName?: string;
  style?: CSSProperties;
}

/** Круглий жовтий штемпель. Сам прихований від зчитувача: його текст зчитується з назви листівки. */
export function StampMark({ text, date = '01.01.2027', time = '00:00', className, hitClassName, style }: StampMarkProps) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const arc = `arc${raw}`;
  const ink = `ink${raw}`;
  return (
    <svg viewBox="0 0 130 130" className={className} style={style} aria-hidden="true" focusable="false">
      <defs>
        <filter id={ink} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="4" />
          <feDisplacementMap in="SourceGraphic" scale="2.2" />
        </filter>
        <path id={arc} d="M21,65 a44,44 0 0,1 88,0" />
      </defs>
      <g className={hitClassName} style={{ transformOrigin: '65px 65px', transformBox: 'view-box' }}>
        <g filter={`url(#${ink})`} fill="none" stroke="currentColor" strokeLinecap="round">
          <circle cx="65" cy="65" r="58" strokeWidth="3" strokeDasharray="70 4 40 3 120 5 60 3" />
          <circle cx="65" cy="65" r="34" strokeWidth="1.5" strokeDasharray="50 3 80 4 70 2" />
          <circle cx="53" cy="109" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="65" cy="112" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="77" cy="109" r="1.8" fill="currentColor" stroke="none" />
          <text fontSize="10.5" fontWeight="600" fill="currentColor" stroke="none">
            <textPath href={`#${arc}`} textLength="132" lengthAdjust="spacingAndGlyphs">
              {text}
            </textPath>
          </text>
          <text x="65" y="62" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">
            {date}
          </text>
          <text x="65" y="81" textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor" stroke="none">
            {time}
          </text>
        </g>
      </g>
    </svg>
  );
}

export interface StampArtProps {
  illustrationId: string;
  /** Текст штемпеля; він же alt листівки. */
  stampText: string;
  /** Показати «удар» штемпеля (CSS грає його лише у `lively`). */
  stamping?: boolean;
  /** Мініатюра для згорнутого стану: лише листівка, без штемпеля й рамки. */
  thumbnail?: boolean;
  className?: string;
}

/** Листівка зі свіжим штемпелем. */
export function StampArt({ illustrationId, stampText, stamping = false, thumbnail = false, className }: StampArtProps) {
  if (thumbnail) {
    return (
      <span className={className} data-stamp-thumbnail="">
        <PostcardArt illustrationId={illustrationId} label={stampText} className="block size-full rounded-sm" fill />
      </span>
    );
  }
  return (
    <div className={`relative rounded-md bg-text p-1.5 ${className ?? ''}`} data-stamp-art="" data-stamping={stamping ? 'true' : 'false'}>
      <PostcardArt illustrationId={illustrationId} label={stampText} className="block w-full rounded-sm" />
      <StampMark text={stampText} className="absolute right-0.5 top-1 w-36 -rotate-12 text-highlight" hitClassName="t2f-stamp-hit" />
    </div>
  );
}
