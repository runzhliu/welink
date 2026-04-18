import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    // charts chunk 单独 500KB+ 是预期内的（recharts 本身大，但首屏不加载）
    // 提高阈值避免无意义 warning；真正的首屏 bundle 有 <300KB gzip 警戒线
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 把"重型可选库"拆成独立 chunk —— 首屏不需要，打开对应页面才加载
        manualChunks: {
          charts: ['recharts'],                    // Stats / 群聊详情 / 年度回顾
          markdown: ['react-markdown', 'remark-gfm', 'marked'], // AI 分析卡 / 对话回放
          qrcode: ['qrcode'],                      // 年度回顾 / 分享卡
          pinyin: ['tiny-pinyin'],                 // Cmd+K 命令面板
          'image-export': ['html2canvas', 'html-to-image'], // 分享为图片 / 年度回顾
          'grid-layout': ['react-grid-layout'],    // 洞察页拖拽排版
          // react / react-dom 不拆：vite 默认已经合理处理 vendor
          // lucide-react 几乎每页都用，留在主 chunk
        },
      },
    },
  },
  server: {
    port: 3418,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
