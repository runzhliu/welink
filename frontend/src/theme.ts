/**
 * WeChat-inspired Design System
 * 微信风格设计令牌系统
 */

export const theme = {
  colors: {
    // 微信品牌色
    wechat: {
      primary: '#07c160',      // 微信绿
      primaryHover: '#06ad56', // 微信绿悬停
      primaryLight: '#e7f8f0', // 微信绿浅色背景
      secondary: '#576b95',    // 微信蓝（公众号）
    },

    // 背景色
    background: {
      primary: '#f8f9fb',      // 主背景
      secondary: '#ffffff',    // 卡片背景
      tertiary: '#ededed',     // 微信聊天背景
      dark: '#1d1d1f',         // 深色背景
      muted: '#f5f5f5',        // 柔和背景
    },

    // 文字颜色
    text: {
      primary: '#1d1d1f',      // 主文字
      secondary: '#666666',    // 次要文字
      tertiary: '#999999',     // 辅助文字
      placeholder: '#c0c0c0',  // 占位文字
      inverse: '#ffffff',      // 反色文字
      link: '#576b95',         // 链接文字
    },

    // 边框颜色
    border: {
      light: '#e5e5e5',        // 浅边框
      medium: '#d9d9d9',       // 中等边框
      dark: '#c0c0c0',         // 深边框
    },

    // 状态色
    status: {
      success: '#07c160',      // 成功
      warning: '#ff9500',      // 警告
      error: '#fa5151',        // 错误
      info: '#10aeff',         // 信息
    },

    // 数据可视化色板
    chart: {
      primary: '#07c160',
      secondary: '#10aeff',
      tertiary: '#ff9500',
      quaternary: '#fa5151',
      quinary: '#576b95',
      gradient: {
        green: ['#07c160', '#06ad56'],
        blue: ['#10aeff', '#0e8dd6'],
        orange: ['#ff9500', '#e68800'],
      }
    }
  },

  // 间距系统 (8px 基准)
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
    '3xl': '48px',
    '4xl': '64px',
  },

  // 圆角
  radius: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
    full: '9999px',
    // 微信特色圆角
    message: '8px',     // 消息气泡
    card: '12px',       // 卡片
    button: '8px',      // 按钮
  },

  // 阴影
  shadow: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
    // 微信特色阴影
    card: '0 2px 8px rgba(0, 0, 0, 0.08)',
    wechat: '0 2px 12px rgba(7, 193, 96, 0.15)', // 微信绿色阴影
  },

  // 字体
  font: {
    family: {
      base: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
      mono: '"SF Mono", Monaco, "Courier New", monospace',
    },
    size: {
      xs: '10px',
      sm: '12px',
      base: '14px',
      lg: '16px',
      xl: '18px',
      '2xl': '24px',
      '3xl': '32px',
      '4xl': '48px',
      '5xl': '64px',
    },
    weight: {
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      black: '900',
    }
  },

  // 动画时长
  transition: {
    fast: '150ms',
    base: '200ms',
    slow: '300ms',
    slower: '500ms',
  },

  // 层级
  zIndex: {
    dropdown: 1000,
    sticky: 1020,
    fixed: 1030,
    modalBackdrop: 1040,
    modal: 1050,
    popover: 1060,
    tooltip: 1070,
  }
} as const;

// 导出类型
export type Theme = typeof theme;
export type ThemeColors = typeof theme.colors;
export type ThemeSpacing = typeof theme.spacing;
