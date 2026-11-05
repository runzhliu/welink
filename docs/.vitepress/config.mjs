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

const SITE_URL = 'https://welink.click'
const OG_IMAGE = `${SITE_URL}/logo.svg`

function getAdsenseClient() {
  const raw = (process.env.ADSENSE_CLIENT || process.env.ADSENSE_PUBLISHER_ID || '').trim()
  if (!raw) return ''

  const publisherId = raw.replace(/^ca-/, '')
  if (!/^pub-\d+$/.test(publisherId)) {
    console.warn(`Invalid AdSense publisher id: ${raw}`)
    return ''
  }
  return `ca-${publisherId}`
}

const adsenseClient = getAdsenseClient()
const adsenseAdSlot = (process.env.ADSENSE_AD_SLOT || '').trim()

const head = [
  ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  // ─── SEO & Open Graph ─────────────────────────────────────────
  ['meta', { name: 'author', content: 'WeLink contributors' }],
  ['meta', { name: 'keywords', content: '微信聊天分析, SFT, LoRA, 模型微调, AI 分身, 关系预测, MCP Server, 本地 AI, 微信数据, welink' }],
  ['meta', { name: 'theme-color', content: '#f6f7f8' }],
  // Open Graph
  ['meta', { property: 'og:type', content: 'website' }],
  ['meta', { property: 'og:site_name', content: 'WeLink' }],
  ['meta', { property: 'og:title', content: 'WeLink · AI 驱动的微信聊天数据分析平台' }],
  ['meta', { property: 'og:description', content: '本地优先的聊天分析与 AI 分身，探索 SFT 工作台：准备数据、微调、评测与模型试用。' }],
  ['meta', { property: 'og:url', content: SITE_URL }],
  ['meta', { property: 'og:image', content: OG_IMAGE }],
  ['meta', { property: 'og:locale', content: 'zh_CN' }],
  // Twitter Card
  ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ['meta', { name: 'twitter:title', content: 'WeLink · AI 驱动的微信聊天数据分析平台' }],
  ['meta', { name: 'twitter:description', content: '本地优先 · SFT 工作台 / AI 分身 / 关系预测 / MCP 集成' }],
  ['meta', { name: 'twitter:image', content: OG_IMAGE }],
]

if (adsenseClient) {
  head.push([
    'script',
    {
      async: true,
      src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`,
      crossorigin: 'anonymous',
    },
  ])
}

export default defineConfig({
  title: 'WeLink',
  description: '本地优先的微信聊天分析平台 · SFT 工作台 / AI 分身 / 关系预测 / 跨联系人问答',
  lang: 'zh-CN',

  ignoreDeadLinks: [/^http:\/\/localhost/],

  // 生成 sitemap.xml 方便搜索引擎索引
  sitemap: {
    hostname: SITE_URL,
  },

  // 懒加载图片（VitePress 原生支持 img 的 loading=lazy）
  markdown: {
    image: {
      lazyLoading: true,
    },
  },

  head,

  vite: {
    define: {
      __ADSENSE_CLIENT__: JSON.stringify(adsenseClient),
      __ADSENSE_AD_SLOT__: JSON.stringify(adsenseAdSlot),
    },
  },

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'WeLink',

    nav: [
      { text: '首页', link: '/' },
      { text: '全部功能', link: '/features' },
      { text: 'SFT 工作台', link: '/sft' },
      { text: '下载安装', link: '/install' },
      { text: 'MCP Server', link: '/mcp-server' },
      { text: 'API 接口', link: '/api' },
      { text: 'FAQ', link: '/faq' },
    ],

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: '产品概览', link: '/' },
          { text: '全部功能', link: '/features' },
          { text: '下载与安装', link: '/install' },
          { text: 'macOS App 安装', link: '/install-macos' },
          { text: 'Windows App 安装', link: '/install-windows' },
          { text: 'Docker 部署', link: '/docker' },
          { text: '使用技巧', link: '/ux' },
          { text: '开发与构建', link: '/development' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: '常见问题 (FAQ)', link: '/faq' },
          { text: '贡献指南', link: '/contribute' },
        ],
      },
      {
        text: 'AI 功能',
        items: [
          { text: 'AI 分身（核心功能）', link: '/ai-clone' },
          { text: 'AI 群聊模拟', link: '/ai-group-sim' },
          { text: '创意实验室', link: '/labs' },
          { text: '跨联系人 AI 问答', link: '/cross-contact-qa' },
          { text: 'AI 分析功能', link: '/ai-analysis' },
          { text: 'AI 播客', link: '/podcast' },
          { text: 'Skill 炼化', link: '/skill-forge' },
          { text: 'SFT 工作台与 LoRA 微调', link: '/sft' },
          { text: 'Ollama 本地 AI 配置', link: '/ollama-setup' },
          { text: 'MCP Server', link: '/mcp-server' },
          { text: 'MCP 客户端接入', link: '/mcp-clients' },
          { text: 'ChatGPT Custom GPT', link: '/chatgpt-gpt' },
        ],
      },
      {
        text: '技术参考',
        items: [
          { text: '文档总览', link: '/README' },
          { text: '整体架构', link: '/architecture' },
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
      message: `WeLink · AGPL-3.0 · 本地优先，数据去向取决于所选服务 · v${version}`,
      copyright: '© 2025 WeLink contributors · <a href="https://github.com/runzhliu/welink">GitHub</a> · <a href="https://github.com/runzhliu/welink/issues">反馈问题</a> · <a href="https://demo.welink.click">在线 Demo</a>',
    },

    search: {
      provider: 'local',
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    },
  },

  lastUpdated: true,
})
