"""Generate top-down SVG preview thumbnails for each track map."""
import json, os, sys

MAPS_DIR = os.path.join(os.path.dirname(__file__), 'maps')

THEME_COLORS = {
    'neon_circuit':  {'bg': '#050510', 'track': '#2a1a40', 'line': '#e040a0', 'dot': '#40e0ff', 'start': '#ffcc00', 'text': '#e0e0ff'},
    'desert_drift':  {'bg': '#c8a050', 'track': '#a08040', 'line': '#e0c070', 'dot': '#ff6020', 'start': '#ffffff', 'text': '#402000'},
    'cyber_highway': {'bg': '#000010', 'track': '#101828', 'line': '#00ccff', 'dot': '#ff00aa', 'start': '#ffcc00', 'text': '#80c0ff'},
}

def make_svg(track_file):
    name = os.path.splitext(os.path.basename(track_file))[0]
    with open(track_file, 'r') as f:
        data = json.load(f)

    pts = data['centerline']
    xs = [p['x'] for p in pts]
    zs = [p['z'] for p in pts]

    # Compute bounding box with padding
    pad = 20
    min_x, max_x = min(xs) - pad, max(xs) + pad
    min_z, max_z = min(zs) - pad, max(zs) + pad
    w = max_x - min_x
    h = max_z - min_z

    # SVG viewport: 400px wide, proportional height
    svg_w = 400
    svg_h = int(400 * h / w) if w > 0 else 400
    scale = svg_w / w

    def tx(x): return (x - min_x) * scale
    def tz(z): return (z - min_z) * scale  # z increases downward in SVG

    colors = THEME_COLORS.get(name, THEME_COLORS['neon_circuit'])
    tw = data['trackWidth'] * scale

    # Build polyline string
    poly = ' '.join(f'{tx(p["x"]):.1f},{tz(p["z"]):.1f}' for p in pts)
    # Close the loop
    poly += f' {tx(pts[0]["x"]):.1f},{tz(pts[0]["z"]):.1f}'

    # Start/finish marker
    sf = data['startFinish']['position']
    sfx, sfz = tx(sf['x']), tz(sf['z'])

    # Checkpoints
    cp_circles = ''
    for cp in data['checkpoints']:
        cx, cz = tx(cp['position']['x']), tz(cp['position']['z'])
        r = cp['radius'] * scale * 0.3
        cp_circles += f'  <circle cx="{cx:.1f}" cy="{cz:.1f}" r="{r:.1f}" fill="none" stroke="{colors["dot"]}" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>\n'

    # Props as small shapes
    prop_shapes = ''
    for prop in data.get('props', []):
        px_val, pz = tx(prop['position']['x']), tz(prop['position']['z'])
        c = prop.get('color', [0.5, 0.5, 0.5])
        color = f'rgb({int(c[0]*255)},{int(c[1]*255)},{int(c[2]*255)})'
        sz = max(prop['scale']['x'], prop['scale']['z']) * scale * 0.4
        sz = max(sz, 2)
        if prop['type'] in ('building',):
            prop_shapes += f'  <rect x="{px_val-sz/2:.1f}" y="{pz-sz/2:.1f}" width="{sz:.1f}" height="{sz:.1f}" fill="{color}" opacity="0.6"/>\n'
        elif prop['type'] in ('rock', 'barrier'):
            prop_shapes += f'  <circle cx="{px_val:.1f}" cy="{pz:.1f}" r="{sz/2:.1f}" fill="{color}" opacity="0.5"/>\n'
        elif prop['type'] == 'cactus':
            prop_shapes += f'  <line x1="{px_val:.1f}" y1="{pz-sz/2:.1f}" x2="{px_val:.1f}" y2="{pz+sz/2:.1f}" stroke="{color}" stroke-width="2" opacity="0.7"/>\n'

    # Spawn positions
    spawn_marks = ''
    for i, sp in enumerate(data.get('spawnPositions', [])):
        sx, sz_val = tx(sp['x']), tz(sp['z'])
        spawn_marks += f'  <circle cx="{sx:.1f}" cy="{sz_val:.1f}" r="4" fill="#00ff80" opacity="0.7"/>\n'
        spawn_marks += f'  <text x="{sx:.1f}" y="{sz_val+1.5:.1f}" text-anchor="middle" font-size="6" fill="#00ff80">P{i+1}</text>\n'

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" width="{svg_w}" height="{svg_h}">
  <rect width="100%" height="100%" fill="{colors['bg']}"/>
  <!-- Track surface -->
  <polyline points="{poly}" fill="none" stroke="{colors['track']}" stroke-width="{tw:.1f}" stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>
  <!-- Track centerline -->
  <polyline points="{poly}" fill="none" stroke="{colors['line']}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  <!-- Props -->
{prop_shapes}
  <!-- Checkpoints -->
{cp_circles}
  <!-- Spawn positions -->
{spawn_marks}
  <!-- Start/finish -->
  <line x1="{sfx-tw/2:.1f}" y1="{sfz:.1f}" x2="{sfx+tw/2:.1f}" y2="{sfz:.1f}" stroke="{colors['start']}" stroke-width="3"/>
  <text x="{sfx:.1f}" y="{sfz-8:.1f}" text-anchor="middle" font-family="monospace" font-size="12" fill="{colors['start']}">START</text>
  <!-- Title -->
  <text x="10" y="20" font-family="monospace" font-size="14" font-weight="bold" fill="{colors['text']}">{data['name']}</text>
  <text x="10" y="36" font-family="monospace" font-size="10" fill="{colors['text']}">{data['difficulty'].upper()} — {data['laps']} laps</text>
</svg>
'''
    out_path = os.path.join(MAPS_DIR, name + '.svg')
    with open(out_path, 'w') as f:
        f.write(svg)
    print(f'  ✓ {out_path}')

if __name__ == '__main__':
    print('Generating track previews...')
    for fn in sorted(os.listdir(MAPS_DIR)):
        if fn.endswith('.json'):
            make_svg(os.path.join(MAPS_DIR, fn))
    print('Done.')
