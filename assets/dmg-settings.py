# dmgbuild settings for WeLink DMG
# https://dmgbuild.readthedocs.io/en/latest/settings.html
#
# 使用方式：
#   dmgbuild -s assets/dmg-settings.py -D app=dist/WeLink.app "WeLink" dist/WeLink.dmg

# 从命令行 -D app=... 读取 .app 路径
application = defines.get('app', 'dist/WeLink.app')  # noqa: F821

# 卷标
volume_name = 'WeLink'

# 输出格式
format = defines.get('format', 'UDZO')  # noqa: F821

# 图标大小
icon_size = 90

# Finder 窗口位置与大小（高度 420 = 背景图高度，确保底部文字不被截断）
window_rect = ((200, 120), (580, 420))

# 图标位置
icon_locations = {
    'WeLink.app':    (140, 210),
    'Applications':  (440, 210),
}

# 文件内容
files = [application]
symlinks = {'Applications': '/Applications'}

# Finder 视图设置
default_view    = 'icon-view'
show_status_bar = False
show_tab_view   = False
show_toolbar    = False
show_pathbar    = False
show_sidebar    = False

# 图标视图细节
arrange_by      = None
grid_offset     = (0, 0)
grid_spacing    = 100
scroll_position = (0, 0)
label_pos       = 'bottom'
text_size       = 12
