"""Стара карта Time2Fest (Figma → JSX, 1781×911) → old_map.json: пояси, країни, шляхи, лінії поясів, кордони, лінія зміни дат.
Запуск: python -X utf8 extract.py <MapCanvas dir> <out.json>"""
import json, os, re, sys

SRC, OUT = sys.argv[1], sys.argv[2]
PATH_RE = re.compile(r'<path\b(.*?)/>', re.S)
ATTR = lambda name, s: (m.group(1) if (m := re.search(name + r'="([^"]*)"', s)) else None)


def paths(text):
    out = []
    for m in PATH_RE.finditer(text):
        a = m.group(1)
        d = ATTR(r'\bd', a)
        if not d:
            continue
        out.append({k: v for k, v in {
            'd': d,
            'cls': ATTR('className', a),
            'fill': ATTR(r'\bfill', a),
            'fo': ATTR('fillOpacity', a),
            'stroke': ATTR(r'\bstroke', a),
            'sw': ATTR('strokeWidth', a),
            'rule': ATTR('fillRule', a),
        }.items() if v})
    return out


def offset_minutes(zid):
    m = re.match(r'UTC([+-])(\d+)(?::(\d+))?$', zid.replace('−', '-'))
    if not m:
        return 0 if zid in ('UTC', 'UTC+0', 'UTC±0') else None
    v = int(m.group(2)) * 60 + int(m.group(3) or 0)
    return -v if m.group(1) == '-' else v


zones = []
zdir = os.path.join(SRC, 'Zones')
for name in sorted(os.listdir(zdir)):
    zp = os.path.join(zdir, name)
    if not os.path.isdir(zp):
        continue
    ztext = open(os.path.join(zp, name + '.jsx'), encoding='utf8').read()
    zid = re.search(r"ZONE_ID = '([^']+)'", ztext).group(1)
    zone_cls = re.search(r"<g className=\{clsx\(([^)]*)\)\}", ztext)
    # Фон поясу (zoneM): смуги/прямокутники в океані.
    zm = re.search(r'className=[{"]\'?zoneM.*?</g>', ztext, re.S)
    ocean = paths(zm.group(0)) if zm else []
    flags = ATTR('data-flags', ztext)
    countries = []
    for imp in re.findall(r"import (\w+) from '\./(\w+)'", ztext):
        comp, folder = imp
        f = os.path.join(zp, folder, folder + '.jsx')
        if not os.path.exists(f):
            alt = [x for x in os.listdir(os.path.join(zp, folder)) if x.endswith('.jsx')]
            if len(alt) != 1:
                print('missing', f)
                continue
            f = os.path.join(zp, folder, alt[0])
        ct = open(f, encoding='utf8').read()
        countries.append({
            'component': folder,
            'iso': (ATTR('data-country', ct) or '').upper(),
            'dataId': ATTR('data-id', ct),
            'gid': ATTR(r'\bid', ct),
            'paths': paths(ct),
        })
    zones.append({'dir': name, 'id': zid, 'offsetMinutes': offset_minutes(zid), 'zoneClass': zone_cls.group(1) if zone_cls else None,
                  'flags': flags, 'ocean': ocean, 'countries': countries})

read = lambda p: open(os.path.join(SRC, p), encoding='utf8').read()
data = {
    'size': [1781, 911],
    'zones': zones,
    'borders': paths(read('Borders/Borders.jsx')),
    'timelines': paths(read('TimeLines/TimeLines.jsx')),
    'dayline': paths(read('DayLine/DayLine.jsx')),
}
json.dump(data, open(OUT, 'w', encoding='utf8'), ensure_ascii=False)
print('zones', len(zones), 'countries', sum(len(z['countries']) for z in zones),
      'paths', sum(len(c['paths']) for z in zones for c in z['countries']), 'ocean', sum(len(z['ocean']) for z in zones),
      'borders', len(data['borders']), 'timelines', len(data['timelines']), 'dayline', len(data['dayline']))
