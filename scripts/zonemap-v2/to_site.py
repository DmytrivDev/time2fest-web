"""Крок 4: map_data.json (стара мапа + офіційні пояси, `lines.py`) → data/zonemap.json для сайту (варіант C «смуги поясів»,
рішення власника 2026-11-02).

  python -X utf8 scripts/zonemap-v2/to_site.py <тека з map_data.json>

Вихід (`ZoneMapGeometry`, lib/map/model.ts):
  zones   — пояс: країни `countries` ({iso, d}), морські області острівних країн `sea` ({iso, d}), смуга в океані
            `band`, точка значка `label` (окремі шляхи країн — для підсвітки країни при наведенні);
  markers — пояси, суходолу яких майже не видно (дрібні острови): точка на мапі;
  borders — кордони країн на суходолі; zoneLines — межі поясів (океан + суходіл, разом із кордонами-межами);
  sea — умовні кордони в морі між острівними країнами; dayline — лінія зміни дат; lakes — великі озера;
  areas — області островів (рамка, якщо `frame`).
"""
import json, re, sys
from pathlib import Path
from shapely.geometry import Point, Polygon, box as _box
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


def d_of(g):
    """(Multi)Polygon → абсолютний шлях M…L…Z (далі `compact`)."""
    out = []
    for poly in getattr(g, 'geoms', [g]):
        if poly.is_empty or poly.geom_type != 'Polygon':
            continue
        for ring in [poly.exterior, *poly.interiors]:
            c = list(ring.coords)[:-1]
            if len(c) > 2:
                out.append('M' + 'L'.join(f'{x:.2f},{y:.2f}' for x, y in c) + 'Z')
    return ''.join(out)


def polys(g):
    """Лише полігони (після різниць бувають лінії й точки)."""
    if g.is_empty:
        return g
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        return g
    return unary_union([q for q in getattr(g, 'geoms', []) if q.geom_type in ('Polygon', 'MultiPolygon')]) if hasattr(g, 'geoms') else Polygon()


# 1. Суходіл: шматки однієї країни в одному поясі — разом, щілини до 0.7 px закрито (шви між провінціями в старому
#    малюнку). Потім — без перекриттів: група поясу, що далі в DOM (менший зсув), лежить зверху й «вирізає» нижчі,
#    тож під курсором завжди саме той пояс, що видно.
ordered = sorted(M['zones'], key=lambda z: -z['offsetMinutes'])  # порядок груп у DOM: UTC+14 … UTC−12
land = {}
for z in ordered:
    for c in z['countries']:
        g = geom(c['d'])
        if not g.is_empty:
            g = polys(g.buffer(0.35, join_style=2).buffer(-0.35, join_style=2))
            land.setdefault(z['offsetMinutes'], {}).setdefault(c['iso'], []).append(g)
land = {o: {iso: unary_union(gs) for iso, gs in cs.items()} for o, cs in land.items()}
# Тонкі смужки (≤ ~2 px завширшки), що відрізала від країни офіційна межа поясу через кілька пікселів розбіжності
# з кордоном старої мапи (Монголія біля Китаю, Мексика біля Белізу), — назад до сусідньої частини тієї ж країни.
for iso in {iso for cs in land.values() for iso in cs}:
    zs_ = [o for o, cs in land.items() if iso in cs]
    if len(zs_) < 2:
        continue
    for o in zs_:
        keep_, moved = [], []
        for q in getattr(land[o][iso], 'geoms', [land[o][iso]]):
            others = [(o2, land[o2][iso]) for o2 in zs_ if o2 != o and land[o2][iso].distance(q) < 0.6]
            if others and q.buffer(-1.0).is_empty:
                o2 = max(others, key=lambda og: q.buffer(0.6).intersection(og[1]).area)[0]
                moved.append((o2, q))
            else:
                keep_.append(q)
        if moved:
            land[o][iso] = unary_union(keep_) if keep_ else Polygon()
            for o2, q in moved:
                land[o2][iso] = polys(unary_union([land[o2][iso], q.buffer(0.05)]))
covered = Polygon()
for z in reversed(ordered):
    o = z['offsetMinutes']
    for iso in list(land.get(o, {})):
        g = polys(land[o][iso].difference(covered))
        land[o][iso] = g
    covered = unary_union([covered, *land.get(o, {}).values()])
# Вузькі смуги (до ~2.4 px) одного поясу країни, що тягнуться вздовж іншого поясу тієї ж країни (розбіжність кордону
# старої мапи й офіційної межі: Альберта під Саскачеваном, Онтаріо біля Верхнього, «ручка» центральної Монголії під
# західною, Північна територія між Західною й Південною Австралією), — тому поясу країни, вздовж якого вони йдуть.
# Інакше кожна смуга малює другу лінію поруч із кордоном. Рішення власника 2026-11-02.
THIN = 1.2
for iso in sorted({iso for cs in land.values() for iso in cs}):
    zs_ = [o for o, cs in land.items() if iso in cs and not cs[iso].is_empty]
    if len(zs_) < 2:
        continue
    for o in zs_:
        g = land[o][iso]
        moves = []
        for q in getattr(g, 'geoms', [g]):
            op = q.buffer(-THIN, join_style=2).buffer(THIN, join_style=2).intersection(q)
            thin = q if op.area < 0.35 * q.area else q.difference(op)
            for t in getattr(thin, 'geoms', [thin]):
                if t.is_empty or t.geom_type != 'Polygon' or t.area < 0.3:
                    continue
                cont = [(o2, t.boundary.intersection(land[o2][iso].buffer(0.3)).length) for o2 in zs_ if o2 != o]
                o2, c = max(cont, key=lambda oc: oc[1])
                if c > 1.0:
                    moves.append((o2, t))
        if moves:
            land[o][iso] = polys(g.difference(unary_union([t for _, t in moves]).buffer(0.01)))
            for o2, t in moves:
                land[o2][iso] = polys(unary_union([land[o2][iso], t.buffer(0.05)]))
# Кордон Західної Австралії — меридіан 129° с.д.: у старій мапі він місцями «ступенем» заходить на ~0.6 px на схід.
# Зайве — смужками по 1 px — сусідові (Північна чи Південна Австралія), до якого смужка прилягає.
if 480 in land and 'AU' in land[480]:
    _wa_x = land[480]['AU'].intersection(_box(1469.7, 640, 1476, 770))
    land[480]['AU'] = polys(land[480]['AU'].difference(_box(1469.7, 640, 1476, 770)))
    for y_ in range(640, 770):
        t = _wa_x.intersection(_box(1469.7, y_, 1476, y_ + 1))
        if t.area > 0.001:
            o2 = max([o for o in (570, 630) if 'AU' in land.get(o, {})],
                     key=lambda o: t.buffer(0.5).intersection(land[o]['AU']).area)
            land[o2]['AU'] = polys(unary_union([land[o2]['AU'], t.buffer(0.02)]))
# Щілини між сусідніми шматками різних країн чи поясів (до ~2.4 px; у старому малюнку крізь них просвічувало тло):
# кожну віддаємо сусідові з найдовшою спільною межею. Затоки, що виходять до океану, лишаються (щілина торкається
# лише одного шматка).
from shapely import STRtree as _Tree
_items = [(o, iso) for o, cs in land.items() for iso, g in cs.items() if not g.is_empty]
_geoms = [land[o][iso] for o, iso in _items]
_tree = _Tree(_geoms)
_all = unary_union(_geoms)
_gaps = polys(_all.buffer(1.2, join_style=2).buffer(-1.2, join_style=2).difference(_all))
_add = {}
for q in getattr(_gaps, 'geoms', [_gaps]):
    if q.is_empty or q.area < 0.05:
        continue
    qb = q.buffer(0.3)
    near = [k for k in _tree.query(qb) if _geoms[k].intersects(qb)]
    if len({_items[k] for k in near}) < 2:
        continue
    k = max(near, key=lambda k: qb.intersection(_geoms[k]).area)
    _add.setdefault(_items[k], []).append(q)
for (o, iso), qs in _add.items():
    land[o][iso] = polys(unary_union([land[o][iso], *qs]).buffer(0))
land_all = unary_union([g for cs in land.values() for g in cs.values()])

# Архіпелаги, позначені областю (рішення власника 2026-11-02): острови — крапками в рамці, без суцільних плям
# (межі поясів з офіційних даних захоплюють і територіальні води, а старі шматки Мальдівів — розмиті плями).
import math
from shapely.geometry import Point, box as _box


def proj(lat, lon):
    x = ((lon + 168.2) % 360) * 4.947
    return x, 580 - (4.947 * 180 / math.pi) * 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat)))


def dots(pts, r=1.1):
    return unary_union([Point(*proj(la, lo)).buffer(r, 8) for la, lo in pts])


ARCHIPELAGOS = {
    # Лакшадвіп (+5:30, Індія): атоли.
    ('IN', 330, 'lak'): [(11.69, 72.71), (11.60, 72.18), (11.48, 73.00), (11.22, 72.78), (11.12, 72.73), (10.85, 72.19),
                          (10.81, 73.68), (10.57, 72.64), (10.07, 73.65), (8.28, 73.05)],
    # Андаманські й Нікобарські острови (+5:30, Індія).
    ('IN', 330, 'and'): [(13.25, 92.92), (12.70, 92.88), (12.10, 92.95), (11.75, 92.70), (12.00, 93.00), (10.65, 92.53),
                          (9.17, 92.80), (8.45, 93.03), (8.25, 93.15), (8.00, 93.50), (7.05, 93.80)],
    # Мальдіви (+5): атоли з півночі на південь.
    ('MV', 300, 'mv'): [(6.95, 72.95), (6.30, 73.20), (5.65, 73.05), (5.10, 73.10), (4.17, 73.51), (3.85, 72.75),
                         (3.40, 73.45), (2.95, 73.55), (2.10, 72.95), (1.85, 73.40), (0.65, 73.15), (-0.30, 73.10),
                         (-0.65, 73.15)],
}
area_frames = []
for (iso, o, key), pts in ARCHIPELAGOS.items():
    d_ = dots(pts)
    x0, y0, x1, y1 = d_.bounds
    frame = _box(x0 - 1.8, y0 - 1.8, x1 + 1.8, y1 + 1.8)
    if o in land and iso in land[o]:
        # Старі плями й шматки в межах рамки — геть; натомість крапки.
        near_ = frame.buffer(5)
        rest_ = [q for q in getattr(land[o][iso], 'geoms', [land[o][iso]]) if not (q.intersects(near_) and q.area < 400)]
        land[o][iso] = polys(unary_union([*rest_, d_]))
    area_frames.append({'zoneId': zone_id(o), 'iso': iso, 'x0': r1(x0 - 1.8), 'y0': r1(y0 - 1.8), 'x1': r1(x1 + 1.8), 'y1': r1(y1 + 1.8), 'frame': True})
frames_u = unary_union([_box(a['x0'], a['y0'], a['x1'], a['y1']) for a in area_frames])
land_all = unary_union([g for cs in land.values() for g in cs.values()])

# 2. Смуги поясів і морські області йдуть і під суходолом — на сайті вони лежать окремим шаром ПІД усім суходолом,
#    тож суходіл їх перекриває і для ока, і для курсора (обрізати їх по береговій лінії — подвоїло б розмір).
# 3. Морські області острівних країн → пояс за островами тієї ж країни.
sea_by_zone = {}
for a in M.get('seaAreas', []):
    g = geom(svg_abs(a['d']) if not a['d'].startswith('M') or 'Z' not in a['d'] else a['d'])
    if g.is_empty:
        continue
    cand = [(o, cs[a['iso']]) for o, cs in land.items() if a['iso'] in cs and not cs[a['iso']].is_empty]
    if not cand:
        continue
    o = max(cand, key=lambda og: (og[1].intersection(g).area, -og[1].distance(g)))[0]
    if g.intersects(frames_u) and g.intersection(frames_u).area > 0.5 * min(g.area, frames_u.area):
        continue
    sea_by_zone.setdefault(o, []).append({'iso': a['iso'], 'd': compact(a['d'], 0.3, True)})

zones, markers = [], []
for z in ordered:
    o = z['offsetMinutes']
    zid = zone_id(o)
    if zid not in ZONE_IDS.values():
        sys.exit(f'Пояс {zid} є на мапі, але не в schedule.json')
    cs = {iso: g for iso, g in land.get(o, {}).items() if not g.is_empty}
    g = unary_union(list(cs.values())) if cs else Polygon()
    parts = sorted(getattr(g, 'geoms', [g]), key=lambda p: -p.area)
    pt = parts[0].representative_point() if parts and not parts[0].is_empty else None
    zones.append({'offset': label(o), 'offsetMinutes': o, 'zoneId': zid,
                  'countries': [{'iso': iso, 'd': compact(d_of(cg), 0.3, True)} for iso, cg in cs.items()],
                  'sea': sea_by_zone.get(o, []),
                  # Пояс +5:30 в океані на старій мапі — лише прямокутники навколо островів (дублюють рамки): без смуги.
                  'band': compact(svg_abs(bands.get(o, '')), 0.2, True) if o != 330 else '',
                  'label': [r1(pt.x), r1(pt.y)] if pt else [0, 0]})
    if (g.area < 60 or (parts and parts[0].area < 30)) and pt is not None:  # пояс з дрібних островів
        markers.append({'zoneId': zid, 'x': r1(pt.x), 'y': r1(pt.y)})
zones.sort(key=lambda z: -z['offsetMinutes'])

# 4. Лінії на суходолі — просто з заливок (рішення 2026-11-02, дефекти «розірваних» кордонів): де два шматки
#    торкаються, там лінія; різні пояси — межа поясу, один пояс і різні країни — кордон. Лінії завжди точно на краях
#    заливок, без розривів і зайвих хвостиків.
from shapely import STRtree
from shapely.geometry import LineString, MultiLineString
from shapely.ops import linemerge
items = [(o, iso, g) for o, cs in land.items() for iso, g in cs.items() if not g.is_empty]
tree = STRtree([g for _, _, g in items])
land_zone, land_border = [], []
for i, (o1, iso1, g1) in enumerate(items):
    near = g1.buffer(0.9)
    for j in tree.query(near):
        if j <= i:
            continue
        o2, iso2, g2 = items[j]
        if g1.distance(g2) > 0.8:
            continue
        shared = g1.boundary.intersection(g2.buffer(0.9))
        segs = [q for q in getattr(shared, 'geoms', [shared]) if q.geom_type in ('LineString', 'MultiLineString')]
        segs = [l for q in segs for l in getattr(q, 'geoms', [q]) if l.length > 0.6]
        (land_zone if o1 != o2 else land_border).extend(segs)


_net = unary_union(land_zone + land_border)


def d_lines(ls):
    if not ls:
        return ''
    merged = linemerge(unary_union(ls))
    out = []
    for l in getattr(merged, 'geoms', [merged]):
        if l.geom_type != 'LineString' or l.length <= 0.6:
            continue
        if l.length < 2:
            # Окремий короткий штрих, не з'єднаний з жодною лінією (залишок від крихітного шматка), — геть.
            rest = _net.difference(l.buffer(0.05))
            if all(rest.distance(Point(*l.coords[k])) > 0.1 for k in (0, -1)):
                continue
        out.append('M' + 'L'.join(f'{x:.2f},{y:.2f}' for x, y in l.coords))
    return ''.join(out)


land_zone_d = d_lines(land_zone)
_sea = []
for m_ in re.finditer(r'M([^M]+)', M['sea']):
    pts = [tuple(map(float, q.split(','))) for q in m_.group(1).split('L') if q.strip()]
    if len(pts) > 1:
        _sea.append(LineString(pts))
_sea_cut = unary_union(_sea).difference(frames_u.buffer(8)) if _sea else LineString()
sea_d = d_lines([l for l in getattr(_sea_cut, 'geoms', [_sea_cut]) if l.geom_type == 'LineString'])

# Лінії поясів в океані (стара мапа): лише поза остаточним суходолом — інакше там, де закрито щілини, вони
# лишаються зайвою другою лінією вздовж кордону.
_ocean = []
for m_ in re.finditer(r'M([^M]+)', M['ocean']):
    pts = [tuple(map(float, q.split(','))) for q in m_.group(1).split('L') if q.strip()]
    if len(pts) > 1:
        _ocean.append(LineString(pts))
_ocean_cut = unary_union(_ocean).difference(land_all.buffer(0.8)) if _ocean else LineString()
ocean_d = d_lines([l for l in getattr(_ocean_cut, 'geoms', [_ocean_cut]) if l.geom_type == 'LineString'])
land_border_d = d_lines(land_border)
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
    'borders': compact(land_border_d, 0.3, False),
    'zoneLines': compact(ocean_d + land_zone_d, 0.3, False),
    'sea': compact(sea_d, 0.3, False),
    'dayline': compact(M['dayline'], 0, False),
    'lakes': ''.join(compact(svg_abs(d), 0.3, True) for d in M['lakes']),
    'areas': area_frames + [{'zoneId': zone_id(a['zone']), 'iso': a['iso'], 'x0': a['box'][0], 'y0': a['box'][1], 'x1': a['box'][2], 'y1': a['box'][3], 'frame': not a['zoneBox']}
              for a in M['areas'] if a['zoneBox']],
}
dst = ROOT / 'data' / 'zonemap.json'
dst.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
print(f'zonemap.json: {dst.stat().st_size // 1024} КБ, поясів {len(zones)}, маркерів {len(markers)}; без суходолу на мапі: {missing}')
