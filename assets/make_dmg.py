#!/usr/bin/env python3
"""
DMG 后处理脚本：接收 dmgbuild 生成的 UDRW DMG，挂载后：
  1. 删除 dmgbuild 遗留的 .background* 隐藏文件和 .fseventsd 目录
  2. 转换为压缩 UDZO 最终发布 DMG
用法：python3 assets/make_dmg.py <udrw_dmg> <output_dmg>
"""
import os
import sys
import shutil
import subprocess
import time


def run(cmd, check=True):
    print('+', ' '.join(str(c) for c in cmd))
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        print('STDOUT:', r.stdout)
        print('STDERR:', r.stderr)
        sys.exit(r.returncode)
    return r


def post_process(udrw_dmg, output_dmg):
    r = run(['hdiutil', 'attach', '-readwrite', '-noverify', '-noautoopen', udrw_dmg])
    mount = None
    for line in r.stdout.splitlines():
        parts = line.split('\t')
        if len(parts) >= 3 and '/Volumes/' in parts[-1]:
            mount = parts[-1].strip()
    if not mount:
        print('ERROR: cannot find mount point\n', r.stdout)
        sys.exit(1)
    print('Mounted at:', mount)

    try:
        # 删除 dmgbuild 遗留的所有点开头隐藏文件/目录（.background*, .fseventsd 等）
        # 只保留 .DS_Store（Finder 布局信息）
        for name in os.listdir(mount):
            if not name.startswith('.'):
                continue
            if name == '.DS_Store':
                continue
            full = os.path.join(mount, name)
            if os.path.isdir(full):
                shutil.rmtree(full)
            else:
                os.remove(full)
            print(f'Removed: {name}')

        run(['sync'])
        time.sleep(1)

    finally:
        run(['hdiutil', 'detach', mount, '-force', '-quiet'], check=False)

    if os.path.exists(output_dmg):
        os.remove(output_dmg)
    run(['hdiutil', 'convert', udrw_dmg,
         '-format', 'UDZO',
         '-imagekey', 'zlib-level=9',
         '-o', output_dmg])
    print(f'\nDone: {output_dmg}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f'Usage: {sys.argv[0]} <udrw_dmg> <output_dmg>')
        sys.exit(1)
    post_process(sys.argv[1], sys.argv[2])
