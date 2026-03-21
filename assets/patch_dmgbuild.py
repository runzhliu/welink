#!/usr/bin/env python3
"""
Patch dmgbuild to replace SetFile calls with xattr equivalents.
Usage: python3 assets/patch_dmgbuild.py
"""
import sys
import subprocess

def find_core():
    r = subprocess.run(
        [sys.executable, '-c', 'import dmgbuild.core; print(dmgbuild.core.__file__)'],
        capture_output=True, text=True, check=True
    )
    return r.stdout.strip()

def main():
    path = find_core()
    print(f'Patching {path}')
    src = open(path).read()

    replacements = [
        (
            'subprocess.call(["/usr/bin/SetFile", "-a", "V"] + to_hide)',
            '(subprocess.call(["xattr", "-wx", "com.apple.FinderInfo", "0000000000000000400000000000000000000000000000000000000000000000", to_hide[0]]) if to_hide else None)',
        ),
        (
            'subprocess.call(["/usr/bin/SetFile", "-a", "E"] + to_hide)',
            'None  # SetFile -a E skipped (not available)',
        ),
        (
            'subprocess.call(["/usr/bin/SetFile", "-a", "C", mount_point])',
            'None  # SetFile -a C skipped (not available)',
        ),
    ]

    patched = 0
    already_done = 0
    for old, new in replacements:
        if old in src:
            src = src.replace(old, new)
            print(f'  Replaced: {old[:60]}...')
            patched += 1
        elif new in src:
            print(f'  Already patched: {old[:60]}...')
            already_done += 1
        else:
            print(f'  WARNING: pattern not found: {old[:60]}...')

    if patched == 0 and already_done == 0:
        print('ERROR: no patterns matched, dmgbuild may have changed')
        sys.exit(1)

    open(path, 'w').write(src)
    print(f'Done. Patched {patched}/3 SetFile calls.')

if __name__ == '__main__':
    main()
