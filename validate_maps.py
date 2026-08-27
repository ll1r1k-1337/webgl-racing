"""Validate all track JSON files against the required schema."""
import json, os, sys

MAPS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'maps')

REQUIRED_TOP = ['name', 'difficulty', 'laps', 'theme', 'trackWidth',
                'centerline', 'walls', 'startFinish', 'spawnPositions',
                'checkpoints', 'props']
REQUIRED_THEME = ['skyColor', 'groundColor', 'ambientColor', 'fogDensity']
VALID_DIFFICULTIES = {'easy', 'medium', 'hard'}
VALID_SIDES = {'left', 'right', 'both'}

errors = []

def err(file, msg):
    errors.append(f'  ✗ {file}: {msg}')

def check_vec3(obj, label, file):
    if not isinstance(obj, dict):
        err(file, f'{label} must be an object, got {type(obj).__name__}')
        return False
    for k in ('x', 'y', 'z'):
        if k not in obj:
            err(file, f'{label} missing key "{k}"')
            return False
        if not isinstance(obj[k], (int, float)):
            err(file, f'{label}.{k} must be a number')
            return False
    return True

def check_color(arr, label, file):
    if not isinstance(arr, list) or len(arr) != 3:
        err(file, f'{label} must be [r,g,b] array of 3 numbers')
        return False
    for v in arr:
        if not isinstance(v, (int, float)):
            err(file, f'{label} values must be numbers')
            return False
    return True

def validate(path):
    fn = os.path.basename(path)
    try:
        with open(path, 'r') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        err(fn, f'Invalid JSON: {e}')
        return

    # Top-level required fields
    for key in REQUIRED_TOP:
        if key not in data:
            err(fn, f'Missing required field "{key}"')

    # name
    if 'name' in data and not isinstance(data['name'], str):
        err(fn, 'name must be a string')

    # difficulty
    if 'difficulty' in data:
        if data['difficulty'] not in VALID_DIFFICULTIES:
            err(fn, f'difficulty must be one of {VALID_DIFFICULTIES}')

    # laps
    if 'laps' in data:
        if not isinstance(data['laps'], int) or data['laps'] < 1:
            err(fn, 'laps must be a positive integer')

    # theme
    if 'theme' in data:
        th = data['theme']
        for key in REQUIRED_THEME:
            if key not in th:
                err(fn, f'theme missing "{key}"')
        for ckey in ('skyColor', 'groundColor', 'ambientColor'):
            if ckey in th:
                check_color(th[ckey], f'theme.{ckey}', fn)
        if 'fogDensity' in th:
            if not isinstance(th['fogDensity'], (int, float)):
                err(fn, 'theme.fogDensity must be a number')

    # trackWidth
    if 'trackWidth' in data:
        if not isinstance(data['trackWidth'], (int, float)) or data['trackWidth'] <= 0:
            err(fn, 'trackWidth must be a positive number')

    # centerline
    if 'centerline' in data:
        cl = data['centerline']
        if not isinstance(cl, list):
            err(fn, 'centerline must be an array')
        elif len(cl) < 3:
            err(fn, f'centerline must have at least 3 points, got {len(cl)}')
        else:
            for i, pt in enumerate(cl):
                check_vec3(pt, f'centerline[{i}]', fn)

    # walls
    if 'walls' in data:
        if not isinstance(data['walls'], list):
            err(fn, 'walls must be an array')
        else:
            for i, w in enumerate(data['walls']):
                if 'side' not in w:
                    err(fn, f'walls[{i}] missing "side"')
                elif w['side'] not in VALID_SIDES:
                    err(fn, f'walls[{i}].side must be one of {VALID_SIDES}')
                for k in ('from', 'to'):
                    if k not in w:
                        err(fn, f'walls[{i}] missing "{k}"')
                    elif not isinstance(w[k], int):
                        err(fn, f'walls[{i}].{k} must be an integer')
                if 'height' not in w:
                    err(fn, f'walls[{i}] missing "height"')
                if 'color' in w:
                    check_color(w['color'], f'walls[{i}].color', fn)

    # startFinish
    if 'startFinish' in data:
        sf = data['startFinish']
        if 'position' not in sf:
            err(fn, 'startFinish missing "position"')
        else:
            check_vec3(sf['position'], 'startFinish.position', fn)
        if 'direction' not in sf:
            err(fn, 'startFinish missing "direction"')

    # spawnPositions
    if 'spawnPositions' in data:
        sp = data['spawnPositions']
        if not isinstance(sp, list):
            err(fn, 'spawnPositions must be an array')
        elif len(sp) < 1:
            err(fn, 'spawnPositions must have at least 1 entry')
        elif len(sp) > 4:
            err(fn, f'spawnPositions should have at most 4, got {len(sp)}')
        else:
            for i, s in enumerate(sp):
                check_vec3(s, f'spawnPositions[{i}]', fn)
                if 'direction' not in s:
                    err(fn, f'spawnPositions[{i}] missing "direction"')

    # checkpoints
    if 'checkpoints' in data:
        cp = data['checkpoints']
        if not isinstance(cp, list):
            err(fn, 'checkpoints must be an array')
        elif len(cp) < 2:
            err(fn, f'checkpoints should have at least 2, got {len(cp)}')
        else:
            for i, c in enumerate(cp):
                if 'position' not in c:
                    err(fn, f'checkpoints[{i}] missing "position"')
                else:
                    check_vec3(c['position'], f'checkpoints[{i}].position', fn)
                if 'radius' not in c:
                    err(fn, f'checkpoints[{i}] missing "radius"')

    # props
    if 'props' in data:
        if not isinstance(data['props'], list):
            err(fn, 'props must be an array')
        else:
            for i, p in enumerate(data['props']):
                if 'type' not in p:
                    err(fn, f'props[{i}] missing "type"')
                if 'position' not in p:
                    err(fn, f'props[{i}] missing "position"')
                else:
                    check_vec3(p['position'], f'props[{i}].position', fn)
                if 'scale' in p:
                    check_vec3(p['scale'], f'props[{i}].scale', fn)
                if 'color' in p:
                    check_color(p['color'], f'props[{i}].color', fn)

    # Wall index bounds check
    if 'walls' in data and 'centerline' in data:
        cl_len = len(data['centerline'])
        for i, w in enumerate(data['walls']):
            fr = w.get('from', 0)
            to = w.get('to', 0)
            if isinstance(fr, int) and fr >= cl_len:
                err(fn, f'walls[{i}].from={fr} exceeds centerline length {cl_len}')
            if isinstance(to, int) and to >= cl_len:
                err(fn, f'walls[{i}].to={to} exceeds centerline length {cl_len}')

def main():
    print(f'Validating track files in {MAPS_DIR}...\n')
    json_files = sorted(f for f in os.listdir(MAPS_DIR) if f.endswith('.json'))

    if not json_files:
        print('  No .json files found in maps/')
        sys.exit(1)

    for fn in json_files:
        path = os.path.join(MAPS_DIR, fn)
        before = len(errors)
        validate(path)
        after = len(errors)
        if after == before:
            with open(path, 'r') as f:
                data = json.load(f)
            print(f'  ✓ {fn} — "{data["name"]}" ({data["difficulty"]}, {data["laps"]} laps, '
                  f'{len(data["centerline"])} centerline pts, {len(data["checkpoints"])} checkpoints, '
                  f'{len(data["props"])} props, {len(data["spawnPositions"])} spawns)')
        else:
            print(f'  ✗ {fn} — {after - before} error(s)')

    print()
    if errors:
        print(f'FAILED — {len(errors)} error(s):')
        for e in errors:
            print(e)
        sys.exit(1)
    else:
        print(f'PASSED — all {len(json_files)} track(s) valid.')

if __name__ == '__main__':
    main()
