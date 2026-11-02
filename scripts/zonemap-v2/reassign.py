"""Крок 2: шматки старої мапи → пояси за офіційними межами (TBB 2026f, tzdata 2026e + Куба з 2026f) на ніч 31.12.2026.
Вхід: old_map.json, tbb.json. Вихід: pieces.json (шматки з iso, зсувом, шляхом) і changes.txt (що змінилось)."""
import json, math, sys
from collections import defaultdict
from shapely.geometry import Polygon, MultiPolygon, Point
from shapely.ops import unary_union
from shapely import STRtree
from svgelements import Path, Move, Close, Line

D = sys.argv[1] if len(sys.argv) > 1 else '.'
old = json.load(open(f'{D}/old_map.json', encoding='utf8'))
tbb = json.load(open(f'{D}/tbb.json', encoding='utf8'))
# tzdata 2026f: Куба лишається на −4 до 2027-11-07 (у локальній 2026e — ще −5).
OVERRIDE = {'America/Havana': -240}

# Зсуви кожної країни на ніч 31.12.2026 (tzdata zone.tab). Країна з одним зсувом отримує його цілком — без розрізання
# за спрощеними межами TBB (там вони трохи зміщені від кордонів старої мапи).
import os, tzdata
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
AT = datetime(2026, 12, 31, 22, 0, tzinfo=timezone.utc)
COUNTRY_OFFSETS = defaultdict(set)
for line in open(os.path.join(os.path.dirname(tzdata.__file__), 'zoneinfo', 'zone.tab'), encoding='utf8'):
    if line.startswith('#') or not line.strip():
        continue
    cc, _, tzid = line.split()[:3]
    o = OVERRIDE.get(tzid, int(AT.astimezone(ZoneInfo(tzid)).utcoffset().total_seconds() // 60))
    COUNTRY_OFFSETS[cc].add(o)
# Рішення власника: Україна — повністю за київським часом (+2, разом з Кримом); Китай — офіційний пекінський час (+8).
COUNTRY_OFFSETS['UA'] = {120}
COUNTRY_OFFSETS['CN'] = {480}


def to_geom(d, step=1.5):
    """Шлях SVG → (Multi)Polygon за правилом evenodd; криві — ламаною."""
    rings, cur = [], []
    for seg in Path(d):
        if isinstance(seg, Move):
            if len(cur) > 2:
                rings.append(cur)
            cur = [(seg.end.x, seg.end.y)]
        elif isinstance(seg, Close):
            if len(cur) > 2:
                rings.append(cur)
            cur = []
        elif isinstance(seg, Line):
            cur.append((seg.end.x, seg.end.y))
        else:
            n = max(2, int(seg.length(error=1e-2) / step))
            cur += [(p.x, p.y) for p in (seg.point(i / n) for i in range(1, n + 1))]
    if len(cur) > 2:
        rings.append(cur)
    g = Polygon()
    for r in rings:
        p = Polygon(r).buffer(0)
        if not p.is_empty:
            g = g.symmetric_difference(p)
    return g.buffer(0)


fmt = lambda o: ('+' if o >= 0 else '−') + f'{abs(o)//60}' + (f':{abs(o)%60:02d}' if abs(o) % 60 else '')

# Офіційні пояси (з перевизначеннями) у пікселях кадру.
zone_parts = defaultdict(list)
for t in tbb['tzids']:
    if not t['d']:
        continue
    zone_parts[OVERRIDE.get(t['tzid'], t['offset'])].append(to_geom(t['d']))
zones = {o: unary_union(ps) for o, ps in zone_parts.items()}
zone_list = list(zones.items())
tree = STRtree([g for _, g in zone_list])

pieces, log = [], []
invisible = lambda p: p.get('fo') == '0.01' or p.get('cls') == 'noBg' or (p.get('fill') is None and p.get('stroke'))
for z in old['zones']:
    for c in z['countries']:
        for p in c['paths']:
            if invisible(p):
                continue  # рамки й зони кліку для дрібних островів — окремо
            g = to_geom(p['d'])
            if g.is_empty:
                continue
            o_old = z['offsetMinutes']
            iso0 = c['iso'] if c['iso'] != 'UK' else 'GB'
            allowed = COUNTRY_OFFSETS.get(iso0)
            if allowed and len(allowed) == 1:
                o_new = next(iter(allowed))
                pieces.append({'iso': iso0, 'comp': c['component'], 'old': o_old, 'cls': p.get('cls'), 'zone': o_new, 'geom': g})
                if o_new != o_old:
                    pt = g.representative_point()
                    log.append(f'{iso0} {c["component"]}: {fmt(o_old)} → {fmt(o_new)} (єдиний зсув країни) у ({pt.x:.0f},{pt.y:.0f})')
                continue
            hits = {}
            for i in tree.query(g):
                o, zg = zone_list[i]
                if allowed and o not in allowed:
                    continue
                a = g.intersection(zg).area
                if a > 0:
                    hits[o] = hits.get(o, 0) + a
            covered = sum(hits.values())
            iso = c['iso'] if c['iso'] != 'UK' else 'GB'
            base = {'iso': iso, 'comp': c['component'], 'old': o_old, 'cls': p.get('cls')}
            if covered < 0.3 * g.area:
                # Дрібний острів поза спрощеними межами: найближчий офіційний пояс у радіусі 25 px, інакше як було.
                pt = g.representative_point()
                best = min(((zg.distance(pt), o) for o, zg in zone_list if not allowed or o in allowed), default=(1e9, o_old))
                o_new = best[1] if best[0] < 25 else o_old
                pieces.append({**base, 'zone': o_new, 'geom': g})
                if o_new != o_old:
                    log.append(f'{iso} {c["component"]}: острів {fmt(o_old)} → {fmt(o_new)} (найближчий пояс, {best[0]:.0f} px) у ({pt.x:.0f},{pt.y:.0f})')
                continue
            top_o, top_a = max(hits.items(), key=lambda kv: kv[1])
            # «Справжня» частина іншого поясу — товста (не смужка 1–2 px уздовж кордону через зсув спрощених меж):
            # після звуження на 2 px лишається ≥ 25 px² (або ≥ 15 % шматка).
            cand = {o: g.intersection(zones[o]) for o in hits}
            real = {o: part for o, part in cand.items() if o == top_o or part.buffer(-2).area >= 25 or hits[o] >= 0.15 * covered}
            if len(real) == 1:
                pieces.append({**base, 'zone': top_o, 'geom': g})
                if top_o != o_old:
                    pt = g.representative_point()
                    log.append(f'{iso} {c["component"]}: {fmt(o_old)} → {fmt(top_o)} цілим шматком ({g.area:.0f} px²) у ({pt.x:.0f},{pt.y:.0f})')
                continue
            # Шматок розрізано офіційною межею; залишок — до сусідньої частини з найдовшою спільною межею.
            major = {o: hits[o] for o in real}
            parts = dict(real)
            rest = g.difference(unary_union(list(parts.values())))
            for r in (getattr(rest, 'geoms', [rest]) if not rest.is_empty else []):
                if r.area < 0.01:
                    continue
                o_best = max(parts, key=lambda o: r.buffer(0.6).intersection(parts[o]).area)
                parts[o_best] = parts[o_best].union(r)
            for o, part in parts.items():
                part = part.buffer(0)
                if part.area > 0.5:
                    pieces.append({**base, 'zone': o, 'geom': part})
            log.append(f'{iso} {c["component"]}: розрізано {fmt(o_old)} → ' + ', '.join(f'{fmt(o)} {a / covered * 100:.0f}%' for o, a in sorted(major.items())))

# Злиття шматків однієї країни в одному поясі.
merged = defaultdict(list)
for p in pieces:
    merged[(p['iso'], p['zone'])].append(p)
out = []
for (iso, zone), ps in merged.items():
    g = unary_union([p['geom'] for p in ps]).buffer(0)
    out.append({'iso': iso, 'zone': zone, 'comps': sorted({p['comp'] for p in ps}), 'old': sorted({p['old'] for p in ps}), 'wkt': g.wkt})
json.dump(out, open(f'{D}/pieces.json', 'w', encoding='utf8'), ensure_ascii=False)
open(f'{D}/changes.txt', 'w', encoding='utf8').write('\n'.join(log))
print('pieces', len(pieces), 'merged', len(out), 'changes', len(log))
by = defaultdict(float)
for p in pieces:
    if p['zone'] != p['old']:
        by[(p['iso'], p['old'], p['zone'])] += p['geom'].area
for (iso, a, b), ar in sorted(by.items(), key=lambda kv: -kv[1]):
    if ar > 40:
        print(f'{iso:3} {fmt(a):>6} → {fmt(b):<6} {ar:8.0f} px²')
