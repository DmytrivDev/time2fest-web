"""Правка `data/zonemap.json`: північний кордон Казахстану з Росією (Омська область).

На старій мапі (Figma) Омська область була всередині контуру Казахстану в поясі +6 (обидва тоді мали UTC+6). Після
переходу Казахстану на єдиний +5 (2024) збірка v2 віддала весь контур Казахстану в +5 — і Омська область стала
Казахстаном. Скрипт відрізає її за кордоном Natural Earth 1:50m (публічне надбання, world-atlas@2.0.2
`countries-50m.json`) і віддає Росії в поясі +6 (Asia/Omsk). Лінії: новий відрізок кордону KZ–RU і краї Омської
області — межі поясів (різні пояси по обидва боки); кордон «Казахстан — Тюменська область» більше не кордон.

Запуск з `web/`: python -X utf8 scripts/zonemap-v2/fix_kz_ru.py <countries-50m.json>
Скрипт ідемпотентний: якщо Омську область уже віддано Росії, нічого не змінює.
"""
import json, math, re, sys
from pathlib import Path
from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union
from svgelements import Path as SvgPath, Move, Close, Line

ROOT = Path(__file__).resolve().parents[2]
DST = ROOT / 'data' / 'zonemap.json'
sys.path.insert(0, str(Path(__file__).parent))


def proj(lat, lon):
    x = ((lon + 168.2) % 360) * 4.947
    return x, 580 - (4.947 * 180 / math.pi) * 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * math.radians(lat)))


def num(v):
    t = f'{round(v, 1):.1f}'.rstrip('0').rstrip('.')
    return '0' if t in ('-0', '') else t


def compact_pts(pts, closed, tol=0.3):
    """Як `compact` у to_site.py: Дуглас — Пекер на `tol` px, M x,y + відносні l dx,dy з 0.1 px."""
    if tol and len(pts) > 3:
        ls = LineString(pts + ([pts[0]] if closed else []))
        sp = list(ls.simplify(tol, preserve_topology=False).coords)
        if closed and len(sp) > 1 and sp[0] == sp[-1]:
            sp = sp[:-1]
        if len(sp) >= (3 if closed else 2):
            pts = sp
    x0, y0 = round(pts[0][0], 1), round(pts[0][1], 1)
    seg, rel, px, py = [f'M{num(x0)},{num(y0)}'], [], x0, y0
    for x, y in pts[1:]:
        x, y = round(x, 1), round(y, 1)
        dx, dy = x - px, y - py
        if abs(dx) < 0.05 and abs(dy) < 0.05:
            continue
        rel.append(f'{num(dx)},{num(dy)}')
        px, py = x, y
    if rel:
        seg.append('l' + ' '.join(rel))
    if closed:
        seg.append('z')
    return ''.join(seg)


def subpaths(d):
    """Шлях мапи (M/l/z) → [(рядок підшляху, [точки], замкнений)]."""
    out = []
    for m in re.finditer(r'M[^M]+', d):
        s = m.group(0)
        pts = []
        for seg in SvgPath(s):
            if isinstance(seg, Move):
                pts = [(seg.end.x, seg.end.y)]
            elif isinstance(seg, Line):
                pts.append((seg.end.x, seg.end.y))
            elif not isinstance(seg, Close):
                raise SystemExit(f'Неочікуваний сегмент {seg}')
        out.append((s, pts, s.rstrip().endswith('z')))
    return out


def area_of(d):
    g = Polygon()
    for _, pts, _ in subpaths(d):
        if len(pts) > 2:
            q = Polygon(pts).buffer(0)
            if not q.is_empty:
                g = g.symmetric_difference(q)
    return g


def d_of(g):
    out = []
    for poly in getattr(g, 'geoms', [g]):
        if poly.geom_type != 'Polygon' or poly.is_empty:
            continue
        for ring in [poly.exterior, *poly.interiors]:
            out.append(compact_pts(list(ring.coords)[:-1], True))
    return ''.join(out)


def ne_country(topo_file, cid):
    topo = json.loads(Path(topo_file).read_text(encoding='utf8'))
    (sx, sy), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    arcs = []
    for a in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in a:
            x += dx
            y += dy
            pts.append(proj(y * sy + ty, x * sx + tx))
        arcs.append(pts)
    arc = lambda i: arcs[~i][::-1] if i < 0 else arcs[i]
    ring = lambda ids: [p for k, i in enumerate(ids) for p in (arc(i) if k == 0 else arc(i)[1:])]
    g = next(g for g in topo['objects']['countries']['geometries'] if g.get('id') == cid)
    polys = [g['arcs']] if g['type'] == 'Polygon' else g['arcs']
    return unary_union([Polygon(ring(p[0]), [ring(h) for h in p[1:]]).buffer(0) for p in polys])


def main():
    M = json.loads(DST.read_text(encoding='utf8'))
    z5 = next(z for z in M['zones'] if z['offsetMinutes'] == 300)
    z6 = next(z for z in M['zones'] if z['offsetMinutes'] == 360)
    kz = next(c for c in z5['countries'] if c['iso'] == 'KZ')
    kz_old = area_of(kz['d'])
    # Омська область: 53.4–58.6° пн. ш., 70–76.3° сх. д. (з запасом). Казахстан північніше 55.5° не заходить.
    x0, y_top = proj(58.8, 69.8)
    x1, y_bot = proj(53.2, 76.6)
    cut = box(x0, y_top, x1, y_bot).difference(ne_country(sys.argv[1], '398'))
    piece = kz_old.intersection(cut)
    piece = unary_union([p for p in getattr(piece, 'geoms', [piece]) if p.geom_type == 'Polygon' and p.area > 2])
    if piece.is_empty or piece.area < 100:
        print(f'Омська область уже не в Казахстані (шматок {piece.area:.1f} px²) — без змін.')
        return
    kz_new = kz_old.difference(piece)
    kz_new = unary_union([p for p in getattr(kz_new, 'geoms', [kz_new]) if p.geom_type == 'Polygon' and p.area > 0.5])
    kz['d'] = d_of(kz_new)
    ru6 = next((c for c in z6['countries'] if c['iso'] == 'RU'), None)
    if ru6 is None:
        ru6 = {'iso': 'RU', 'd': ''}
        z6['countries'].append(ru6)
    ru6['d'] = d_of(unary_union([area_of(ru6['d']), piece]).buffer(0))

    # Лінії: усе по краю шматка — межа поясу (+5|+6 з Казахстаном і Тюменню, +6|+7 з Томською й Новосибірською).
    # Старі лінії вздовж краю прибрати (і кордони, і межі поясів), натомість — увесь край однією лінією поясу.
    if piece.geom_type != 'Polygon':
        raise SystemExit('Шматок Омської області не одним полігоном — перевірити вручну')
    edge = piece.exterior
    near = edge.buffer(0.7)

    def trim(d):
        keep = []
        for s, pts, _ in subpaths(d):
            ls = LineString(pts)
            if not ls.intersects(near):
                keep.append(s)
                continue
            rest = ls.difference(near)
            for l in getattr(rest, 'geoms', [rest]):
                if l.geom_type != 'LineString' or l.length <= 0.6:
                    continue
                c = list(l.coords)
                # Кінець, що його обрізав край, — дотягнути до краю, щоб на стику не було щілини.
                for k in (0, -1):
                    p = LineString([c[k], c[k]]).centroid
                    if 0.01 < edge.distance(p) < 0.8:
                        q = edge.interpolate(edge.project(p))
                        c = [(q.x, q.y)] + c if k == 0 else c + [(q.x, q.y)]
                keep.append(compact_pts(c, False, 0))
        return ''.join(keep)

    M['borders'] = trim(M['borders'])
    M['zoneLines'] = trim(M['zoneLines']) + compact_pts(list(edge.coords), False)
    DST.write_text(json.dumps(M, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    print(f'Омська область: {piece.area:.0f} px² з Казахстану (+5) до Росії (+6); KZ {kz_old.area:.0f} → {kz_new.area:.0f} px²')


if __name__ == '__main__':
    main()
