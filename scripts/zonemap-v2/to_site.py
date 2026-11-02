"""Крок 4: map_data.json (стара мапа + офіційні пояси, `lines.py`) → data/zonemap.json для сайту (варіант C «смуги поясів»,
рішення власника 2026-11-02).

  python -X utf8 scripts/zonemap-v2/to_site.py <тека з map_data.json>

Вихід (`ZoneMapGeometry`, components/live/MapModel.ts):
  zones   — пояс: країни `countries` ({iso, d}), морські області острівних країн `sea` ({iso, d}), смуга в океані
            `band`, точка значка `label` (окремі шляхи країн — для підсвітки країни при наведенні);
  markers — пояси, суходолу яких майже не видно (дрібні острови): точка на мапі;
  borders — кордони країн на суходолі; zoneLines — межі поясів (океан + суходіл, разом із кордонами-межами);
  sea — умовні кордони в морі між острівними країнами; dayline — лінія зміни дат; lakes — великі озера;
  areas — області островів (рамка, якщо `frame`).
"""
import json, re, sys
from pathlib import Path
from shapely.geometry import Polygon
from shapely.ops import unary_union
from svgelements import Path as SvgPath, Move, Close, Line

SRC = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parents[2]
M = json.loads((SRC / 'map_data.json').read_text(encoding='utf8'))
schedule = json.loads((ROOT / 'data' / 'schedule.json').read_text(encoding='utf8'))
ZONE_IDS = {z['offsetMinutes']: z['id'] for z in schedule['zones']}


def zone_id(o):
    a = abs(o)
    return f"utc{'-' if o < 0 else '+'}{a // 60:02d}{a % 60:02d}"


def label(o):
    a = abs(o)
    return f"{'-' if o < 0 else '+'}{a // 60}" + (f':{a % 60:02d}' if a % 60 else '')


def geom(d):
    """Шлях M…L…Z → Polygon (evenodd) для площі й точки підпису."""
    g = Polygon()
    for ring in re.findall(r'M([^MZ]+)Z', d):
        pts = [tuple(map(float, p.split(','))) for p in ring.split('L')]
        if len(pts) > 2:
            q = Polygon(pts).buffer(0)
            if not q.is_empty:
                g = g.symmetric_difference(q)
    return g


def r1(v):
    return round(v, 1)


def num(v):
    t = f'{round(v, 1):.1f}'.rstrip('0').rstrip('.')
    return '0' if t in ('-0', '') else t


def compact(d, tol=0.3, closed=None):
    """Абсолютні M/L(/Z) → M x,y + відносні l dx,dy з 0.1 px; спрощення Дугласа — Пекера на `tol` px."""
    from shapely.geometry import LineString
    out = []
    for m in re.finditer(r'M([^M]+)', d):
        body = m.group(1)
        is_closed = body.rstrip().endswith('Z') if closed is None else closed
        pts = [tuple(map(float, p.split(','))) for p in body.replace('Z', '').split('L') if p.strip()]
        if len(pts) < 2:
            continue
        if tol and len(pts) > 3:
            ls = LineString(pts + ([pts[0]] if is_closed else []))
            sp = list(ls.simplify(tol, preserve_topology=False).coords)
            if is_closed and len(sp) > 1 and sp[0] == sp[-1]:
                sp = sp[:-1]
            if len(sp) >= (3 if is_closed else 2):
                pts = sp
        x0, y0 = round(pts[0][0], 1), round(pts[0][1], 1)
        seg = [f'M{num(x0)},{num(y0)}']
        px, py = x0, y0
        rel = []
        for x, y in pts[1:]:
            x, y = round(x, 1), round(y, 1)
            dx, dy = x - px, y - py
            if abs(dx) < 0.05 and abs(dy) < 0.05:
                continue
            rel.append(f'{num(dx)},{num(dy)}')
            px, py = x, y
        if rel:
            seg.append('l' + ' '.join(rel))
        if is_closed:
            seg.append('z')
        out.append(''.join(seg))
    return ''.join(out)


def svg_abs(d, step=1.5):
    """Будь-який шлях SVG (H, V, C…) → абсолютні M/L/Z."""
    if not d:
        return ''
    out, cur = [], []
    for seg in SvgPath(d):
        if isinstance(seg, Move):
            if len(cur) > 1:
                out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in cur) + 'Z')
            cur = [(seg.end.x, seg.end.y)]
        elif isinstance(seg, Close):
            if len(cur) > 1:
                out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in cur) + 'Z')
            cur = []
        elif isinstance(seg, Line):
            cur.append((seg.end.x, seg.end.y))
        else:
            n = max(2, int(seg.length(error=1e-2) / step))
            cur += [(q.x, q.y) for q in (seg.point(i / n) for i in range(1, n + 1))]
    if len(cur) > 1:
        out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in cur) + 'Z')
    return ''.join(out)


bands = {b['offsetMinutes']: b['d'] for b in M['bands']}

# Морські області острівних країн (стара мапа) → пояс за островами тієї ж країни всередині області.
land_by_iso = {}
for z in M['zones']:
    for c in z['countries']:
        land_by_iso.setdefault(c['iso'], []).append((z['offsetMinutes'], geom(c['d'])))
sea_by_zone = {}
for a in M.get('seaAreas', []):
    g = geom(svg_abs(a['d']) if not a['d'].startswith('M') or 'Z' not in a['d'] else a['d'])
    if g.is_empty:
        continue
    cand = land_by_iso.get(a['iso'], [])
    if not cand:
        continue
    o = max(cand, key=lambda og: (og[1].intersection(g).area, -og[1].distance(g)))[0]
    sea_by_zone.setdefault(o, []).append({'iso': a['iso'], 'd': compact(a['d'], 0.3, True)})

zones, markers = [], []
for z in M['zones']:
    o = z['offsetMinutes']
    zid = zone_id(o)
    if zid not in ZONE_IDS.values():
        sys.exit(f'Пояс {zid} є на мапі, але не в schedule.json')
    d = ''.join(c['d'] for c in z['countries'])
    g = geom(d)
    parts = sorted(getattr(g, 'geoms', [g]), key=lambda p: -p.area)
    pt = parts[0].representative_point() if parts and not parts[0].is_empty else None
    zones.append({'offset': label(o), 'offsetMinutes': o, 'zoneId': zid,
                  'countries': [{'iso': c['iso'], 'd': compact(c['d'], 0.3, True)} for c in z['countries']],
                  'sea': sea_by_zone.get(o, []),
                  'band': compact(svg_abs(bands.get(o, '')), 0.2, True),
                  'label': [r1(pt.x), r1(pt.y)] if pt else [0, 0]})
    if (g.area < 60 or (parts and parts[0].area < 30)) and pt is not None:  # пояс з дрібних островів
        markers.append({'zoneId': zid, 'x': r1(pt.x), 'y': r1(pt.y)})
zones.sort(key=lambda z: -z['offsetMinutes'])
missing = sorted(set(ZONE_IDS.values()) - {z['zoneId'] for z in zones})
L = M['lines']
out = {
    'meta': {
        'width': 1781, 'height': 911, 'lon0': -168.2, 'pxPerDeg': 4.947, 'equatorY': 580,
        'source': 'Стара мапа Time2Fest (Figma, перевірена вручну) + пояси на ніч 31.12.2026 за tzdata 2026f і '
                  'timezone-boundary-builder 2026f (scripts/zonemap-v2)',
        'projection': 'miller, кадр 1781×911, 4.947 px/°, лівий край 168.2° з.д., екватор y=580',
    },
    'zones': zones,
    'markers': markers,
    'borders': compact(L['country'], 0.3, False),
    'zoneLines': compact(M['ocean'] + L['zone'] + L['both'], 0.3, False),
    'sea': compact(M['sea'], 0.3, False),
    'dayline': compact(M['dayline'], 0, False),
    'lakes': ''.join(compact(svg_abs(d), 0.3, True) for d in M['lakes']),
    'areas': [{'zoneId': zone_id(a['zone']), 'iso': a['iso'], 'x0': a['box'][0], 'y0': a['box'][1], 'x1': a['box'][2], 'y1': a['box'][3], 'frame': not a['zoneBox']}
              for a in M['areas']],
}
dst = ROOT / 'data' / 'zonemap.json'
dst.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(f'zonemap.json: {dst.stat().st_size // 1024} КБ, поясів {len(zones)}, маркерів {len(markers)}; без суходолу на мапі: {missing}')
