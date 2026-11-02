"""Крок 3: острови, яких немає на старій мапі (з офіційних меж) + лінії.
Лінії: кордони старої мапи класифікуються за поясами по обидва боки:
  country       — кордон країн у межах одного поясу;
  both          — кордон країн, що водночас межа поясів;
  zone          — межа поясів усередині країни;
  (stale)       — стара лінія всередині країни, що більше не межа поясів, — прибирається.
Плюс згенеровані межі поясів усередині країн, яких на старій мапі не було (нові розрізи), океанські лінії поясів
(старі TimeLines поза суходолом) і лінія зміни дат. Вихід: map_data.json."""
import json, math, sys
from collections import defaultdict
from shapely import wkt, STRtree
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import unary_union, linemerge
from svgelements import Path, Move, Close, Line

D = sys.argv[1] if len(sys.argv) > 1 else '.'
old = json.load(open(f'{D}/old_map.json', encoding='utf8'))
tbb = json.load(open(f'{D}/tbb.json', encoding='utf8'))
P = json.load(open(f'{D}/pieces.json', encoding='utf8'))
for p in P:
    p['geom'] = wkt.loads(p['wkt'])


def polylines(d, step=1.0):
    out, cur = [], []
    for seg in Path(d):
        if isinstance(seg, Move):
            if len(cur) > 1:
                out.append(cur)
            cur = [(seg.end.x, seg.end.y)]
        elif isinstance(seg, Close):
            if cur:
                cur.append(cur[0])
            if len(cur) > 1:
                out.append(cur)
            cur = []
        elif isinstance(seg, Line):
            cur.append((seg.end.x, seg.end.y))
        else:
            n = max(2, int(seg.length(error=1e-2) / step))
            cur += [(q.x, q.y) for q in (seg.point(i / n) for i in range(1, n + 1))]
    if len(cur) > 1:
        out.append(cur)
    return out


def to_geom(d):
    g = Polygon()
    for r in polylines(d, 1.5):
        if len(r) > 2:
            q = Polygon(r).buffer(0)
            if not q.is_empty:
                g = g.symmetric_difference(q)
    return g.buffer(0)


# ── 1. Острови, яких бракує: Чатем (+13:45), Норонья й Південна Джорджія (−2), Норфолк, Лорд-Гав, Кокосові ──
ADD = {'Pacific/Chatham': ('NZ', 825), 'America/Noronha': ('BR', -120), 'Atlantic/South_Georgia': ('GS', -120),
       'Pacific/Norfolk': ('NF', 720), 'Australia/Lord_Howe': ('AU', 660), 'Indian/Cocos': ('CC', 390)}
OFF = {'America/Havana': -240}
land = unary_union([p['geom'] for p in P])
added = []
for t in tbb['tzids']:
    want = [k for k in ADD if k == t['tzid']]
    if not want or not t['d']:
        continue
    iso, zone = ADD[want[0]]
    g = to_geom(t['d'])
    for part in getattr(g, 'geoms', [g]):
        if part.distance(land) > 3:
            iso_p = 'GS' if t['tzid'] == 'America/Noronha' and part.centroid.y > 800 else iso
            P.append({'iso': iso_p, 'zone': zone, 'geom': part, 'added': t['tzid']})
            added.append((t['tzid'], round(part.centroid.x), round(part.centroid.y), round(part.area, 1)))
# Злиття за (iso, zone) після додавання.
m = defaultdict(list)
for p in P:
    m[(p['iso'], p['zone'])].append(p['geom'])
P = [{'iso': iso, 'zone': z, 'geom': unary_union(gs).buffer(0)} for (iso, z), gs in m.items()]
print('added islands', added)

# Області островів: на старій мапі — прямокутники (Маркізькі, Андаманські й Нікобарські, Лакшадвіп). Прямокутник
# прибираємо із суходолу, натомість — справжні острови з офіційних меж усередині області; сама область — рамкою.
from shapely.geometry import box as _box
tz_by_off = defaultdict(list)
for t in tbb['tzids']:
    if t['d']:
        tz_by_off[OFF.get(t['tzid'], t['offset'])].append(t['d'])
AREAS = []
for p in P:
    keep = []
    for part in getattr(p['geom'], 'geoms', [p['geom']]):
        if part.area > 20 and part.area / _box(*part.bounds).area > 0.93:
            area = _box(*part.bounds).buffer(14)
            others = unary_union([q['geom'] for q in P if q is not p]).buffer(1)
            found = []
            for d in tz_by_off[p['zone']]:
                for q in getattr(to_geom(d), 'geoms', []) or [to_geom(d)]:
                    if q.geom_type == 'Polygon' and q.area > 0.05 and q.intersects(area) and not q.intersects(others):
                        found.append(q)
            keep += found
            bb = unary_union(found + [part.buffer(-2)]).bounds if found else part.bounds
            fb = [bb[0] - 2.5, bb[1] - 2.5, bb[2] + 2.5, bb[3] + 2.5]
            zbox = [to_geom(o['d']) for z0 in old['zones'] if z0['offsetMinutes'] == p['zone'] for o in z0['ocean']]
            zb = [g0 for g0 in zbox if g0.intersects(part)]
            zoneBox = False
            if zb:
                zx0, zy0, zx1, zy1 = unary_union(zb).bounds
                # Острови вміщаються в «коробку» поясу з океану (Маркізькі, −9:30) — область = коробка, рамка = лінія поясу.
                if bb[0] >= zx0 and bb[1] >= zy0 and bb[2] <= zx1 and bb[3] <= zy1:
                    fb = [zx0, zy0, zx1, zy1]
                    zoneBox = True
            AREAS.append({'zone': p['zone'], 'iso': p['iso'], 'box': [round(v, 1) for v in fb], 'zoneBox': zoneBox, 'old': [round(v, 1) for v in part.bounds]})
        else:
            keep.append(part)
    p['geom'] = unary_union(keep).buffer(0) if keep else p['geom'].__class__()
P = [p for p in P if not p['geom'].is_empty]
print('areas', AREAS)

tree = STRtree([p['geom'] for p in P])
# «Застарілою» може бути лише лінія всередині країни, яка на старій мапі мала кілька поясів (стара межа поясів).
MULTI_OLD = {('GB' if c['iso'] == 'UK' else c['iso']) for c0 in [defaultdict(set)] for z in old['zones'] for c in z['countries'] if not c0[c['iso']].add(z['offsetMinutes'])}
_cnt = defaultdict(set)
for z in old['zones']:
    for c in z['countries']:
        _cnt['GB' if c['iso'] == 'UK' else c['iso']].add(z['offsetMinutes'])
MULTI_OLD = {iso for iso, s in _cnt.items() if len(s) > 1}


def side(pt):
    hit = [i for i in tree.query(pt) if P[i]['geom'].covers(pt)]
    if not hit:
        near = [i for i in tree.query(pt.buffer(1.2)) if P[i]['geom'].distance(pt) < 1.2]
        hit = near
    if not hit:
        return None
    p = P[hit[0]]
    return (p['iso'], p['zone'])


def classify(a, b, c):
    """Пробні точки ±2.5 px від середини відрізка a–b."""
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1
    nx, ny = -dy / n, dx / n
    L, R = side(Point(mx + nx * 2.5, my + ny * 2.5)), side(Point(mx - nx * 2.5, my - ny * 2.5))
    if L is None or R is None:
        return 'country'
    if L[1] != R[1]:
        return 'both' if L[0] != R[0] else 'zone'
    if L[0] != R[0] or L[0] not in MULTI_OLD:
        return 'country'
    return 'stale'


def split_by_class(pts):
    """Ламана → шматки за класом (відрізки ≤ 2 px)."""
    dense = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        L = math.dist(a, b)
        k = max(1, int(L / 2))
        dense += [(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k) for i in range(1, k + 1)]
    cls = [classify(a, b, None) for a, b in zip(dense, dense[1:])]
    # Згладжування: поодинокі «стрибки» класу (≤ 2 відрізки) — за сусідами.
    for i in range(1, len(cls) - 1):
        if cls[i - 1] == cls[i + 1] != cls[i]:
            cls[i] = cls[i - 1]
    out, start = [], 0
    for i in range(1, len(cls) + 1):
        if i == len(cls) or cls[i] != cls[start]:
            out.append((cls[start], dense[start:i + 1]))
            start = i
    return out


lines = defaultdict(list)
lakes = []
for b in old['borders']:
    if b.get('fill') and not b.get('stroke'):
        lakes.append(b['d'])
        continue
    for pl in polylines(b['d']):
        for cls, seg in split_by_class(pl):
            if len(seg) > 1:
                lines[cls].append(LineString(seg))

# ── 2. Межі поясів усередині країн, яких немає серед старих кордонів (нові розрізи) ──
existing = unary_union(lines['zone'] + lines['both'] + lines['country'] + lines['stale']).buffer(2.0) if lines else Polygon()
by_iso = defaultdict(list)
for p in P:
    by_iso[p['iso']].append(p)
gen = []
for iso, ps in by_iso.items():
    for i in range(len(ps)):
        for j in range(i + 1, len(ps)):
            shared = ps[i]['geom'].boundary.intersection(ps[j]['geom'].buffer(0.8))
            if shared.is_empty:
                continue
            new = shared.difference(existing)
            for ln in getattr(new, 'geoms', [new]):
                if ln.geom_type == 'LineString' and ln.length > 3:
                    gen.append(ln)
lines['zone'] += gen
print('generated internal zone lines', len(gen), round(sum(l.length for l in gen)))

# ── 3. Океанські лінії поясів: старі TimeLines поза суходолом ──
land = unary_union([p['geom'] for p in P])
landb = land.buffer(1.5)
# Лінії поясу, що обводили старі прямокутники островів (Індія +5:30), — замість них рамка області.
area_old = unary_union([_box(*a['old']).buffer(3.5) for a in AREAS if not a['zoneBox']]) if AREAS else Polygon()
ocean = []
for t in old['timelines']:
    for pl in polylines(t['d']):
        ln = LineString(pl).difference(landb).difference(area_old)
        for part in getattr(ln, 'geoms', [ln]):
            if part.geom_type == 'LineString' and part.length > 2:
                ocean.append(part)
dayline = [LineString(pl) for t in old['dayline'] for pl in polylines(t['d'])]

# Морські області острівних країн (на старій мапі — прозорі зони кліку зі «сходинками») → умовні морські кордони.
sea_polys = []
for z in old['zones']:
    for c in z['countries']:
        for p in c['paths']:
            if p.get('fo') == '0.01':
                g = to_geom(p['d'])
                if not g.is_empty:
                    sea_polys.append(('GB' if c['iso'] == 'UK' else c['iso'], g))
ocean_u = unary_union(ocean).buffer(1.2) if ocean else Polygon()
sea_lines = []
for iso, g in sea_polys:
    for ring in [g.boundary]:
        ln = ring.difference(ocean_u).difference(land.buffer(1.0))
        for part in getattr(ln, 'geoms', [ln]):
            if part.geom_type == 'LineString' and part.length > 2:
                sea_lines.append(part)
area_u = unary_union([_box(*a['box']).buffer(4) for a in AREAS]) if AREAS else Polygon()
sea_lines = [l.difference(area_u) for l in sea_lines]
sea_lines = [q for l in sea_lines for q in getattr(l, 'geoms', [l]) if q.geom_type == 'LineString' and q.length > 2]
sea_u = unary_union(sea_lines)
sea_lines = [l for l in getattr(sea_u, 'geoms', [sea_u]) if l.geom_type == 'LineString']
SEA_AREAS = [{'iso': iso, 'd': ''} for iso, g in sea_polys]


def d_lines(ls):
    ms = linemerge(ls) if ls else MultiLineString()
    parts = getattr(ms, 'geoms', [ms]) if not ms.is_empty else []
    return ''.join('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in l.simplify(0.25).coords) for l in parts if l.length > 0.5)


def d_poly(g):
    out = []
    for poly in getattr(g, 'geoms', [g]):
        if poly.geom_type != 'Polygon' or poly.is_empty:
            continue
        for ring in [poly.exterior, *poly.interiors]:
            c = list(ring.simplify(0.2).coords)
            if len(c) > 3:
                out.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in c[:-1]) + 'Z')
    return ''.join(out)


zones = defaultdict(list)
for p in P:
    zones[p['zone']].append(p)
data = {
    'zones': [{'offsetMinutes': z, 'countries': [{'iso': p['iso'], 'd': d_poly(p['geom'])} for p in ps]} for z, ps in sorted(zones.items())],
    'lines': {k: d_lines(v) for k, v in lines.items() if k != 'stale'},
    'stale': d_lines(lines['stale']),
    'ocean': d_lines(ocean),
    'dayline': d_lines(dayline),
    'lakes': lakes,
    'areas': AREAS,
    'sea': d_lines(sea_lines),
    'bands': [{'offsetMinutes': z['offsetMinutes'], 'd': ''.join(o['d'] for o in z['ocean'])} for z in old['zones']],
    'seaAreas': [{'iso': iso, 'd': d_poly(g)} for iso, g in sea_polys],
}
json.dump(data, open(f'{D}/map_data.json', 'w', encoding='utf8'), ensure_ascii=False)
print({k: len(v) for k, v in data['lines'].items()}, 'stale', len(data['stale']), 'ocean', len(data['ocean']))
print('size KB', round(len(json.dumps(data)) / 1024))
