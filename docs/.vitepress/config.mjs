import { defineConfig } from 'vitepress'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 获取版本号：有精确 tag 则用 tag，否则用 commit 短 hash
function getVersion() {
  try {
    // 检查是否有精确匹配的 tag（如 v0.1.0）
    const tag = execSync('git describe --tags --exact-match 2>/dev/null', { encoding: 'utf-8' }).trim()
    if (tag) return tag
  } catch {}
  try {
    // 没有 tag，用 commit 短 hash
    return execSync('git rev-parse --short=6 HEAD', { encoding: 'utf-8' }).trim()
  } catch {}
  // 都失败了（比如 Docker 构建时没有 .git），读环境变量
  return process.env.WELINK_VERSION || 'dev'
}

const version = getVersion()

export default defineConfig({
  title: 'WeLink',
  description: 'AI 驱动的微信聊天数据分析平台',
  lang: 'zh-CN',

  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'WeLink',

    nav: [
      { text: '首页', link: '/' },
      { text: '下载安装', link: '/install' },
      { text: 'MCP Server', link: '/mcp-server' },
      { text: 'API 接口', link: '/api' },
    ],

    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '产品概览', link: '/' },
          { text: '下载与安装', link: '/install' },
          { text: '使用技巧', link: '/ux' },
          { text: '开发与构建', link: '/development' },
        ],
      },
      {
        text: 'AI 功能',
        items: [
          { text: 'AI 分身（核心功能）', link: '/ai-clone' },
          { text: 'AI 群聊模拟', link: '/ai-group-sim' },
          { text: '跨联系人 AI 问答', link: '/cross-contact-qa' },
          { text: 'AI 分析功能', link: '/ai-analysis' },
          { text: 'Skill 炼化', link: '/skill-forge' },
          { text: 'Ollama 本地 AI 配置', link: '/ollama-setup' },
          { text: 'MCP Server', link: '/mcp-server' },
        ],
      },
      {
        text: '技术参考',
        items: [
          { text: '文档总览', link: '/README' },
          { text: 'API 接口文档', link: '/api' },
          { text: '数据库结构', link: '/database' },
          { text: '消息类型说明', link: '/message-types' },
          { text: '索引与初始化', link: '/indexing' },
          { text: '情感分析', link: '/sentiment' },
          { text: '词云生成', link: '/wordcloud' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/runzhliu/welink' },
    ],

    footer: {
      message: 'WeLink — 所有数据仅在本地处理，不上传任何服务器',
    },

    search: {
      provider: 'local',
    },
  },
})
