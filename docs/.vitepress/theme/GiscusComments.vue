<script setup>
/**
 * Giscus 评论组件 —— 基于 GitHub Discussions，单用户项目够用
 *
 * 启用步骤：
 * 1. 到 https://github.com/apps/giscus 把 Giscus App 安装到你的仓库
 * 2. 到 https://giscus.app 选仓库 + Discussion 类别，生成 data-repo-id / data-category-id
 * 3. 填到下方 GISCUS_CONFIG，保存即启用
 *
 * 留空 data-repo-id 则组件不渲染（当前状态），不影响站点。
 */

import { onMounted, watch, ref, nextTick } from 'vue'
import { useRoute, useData } from 'vitepress'

const GISCUS_CONFIG = {
  repo: 'runzhliu/welink',
  repoId: '',              // ← 填这里启用
  category: 'General',
  categoryId: '',          // ← 填这里启用
  mapping: 'pathname',
  reactionsEnabled: '1',
  emitMetadata: '0',
  inputPosition: 'top',
  lang: 'zh-CN',
}

const route = useRoute()
const { isDark } = useData()
const container = ref(null)

const load = () => {
  if (!container.value || !GISCUS_CONFIG.repoId || !GISCUS_CONFIG.categoryId) return
  container.value.innerHTML = ''
  const s = document.createElement('script')
  s.src = 'https://giscus.app/client.js'
  s.setAttribute('data-repo', GISCUS_CONFIG.repo)
  s.setAttribute('data-repo-id', GISCUS_CONFIG.repoId)
  s.setAttribute('data-category', GISCUS_CONFIG.category)
  s.setAttribute('data-category-id', GISCUS_CONFIG.categoryId)
  s.setAttribute('data-mapping', GISCUS_CONFIG.mapping)
  s.setAttribute('data-strict', '0')
  s.setAttribute('data-reactions-enabled', GISCUS_CONFIG.reactionsEnabled)
  s.setAttribute('data-emit-metadata', GISCUS_CONFIG.emitMetadata)
  s.setAttribute('data-input-position', GISCUS_CONFIG.inputPosition)
  s.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  s.setAttribute('data-lang', GISCUS_CONFIG.lang)
  s.crossOrigin = 'anonymous'
  s.async = true
  container.value.appendChild(s)
}

onMounted(load)
watch(() => route.path, () => nextTick(load))

// 主题切换时，通过 postMessage 同步 giscus iframe
watch(isDark, () => {
  const iframe = document.querySelector('iframe.giscus-frame')
  if (!iframe) return
  iframe.contentWindow.postMessage(
    { giscus: { setConfig: { theme: isDark.value ? 'dark' : 'light' } } },
    'https://giscus.app',
  )
})

const enabled = !!(GISCUS_CONFIG.repoId && GISCUS_CONFIG.categoryId)
</script>

<template>
  <div v-if="enabled" class="giscus-wrapper" style="margin-top:48px;padding-top:24px;border-top:1px solid var(--vp-c-divider);">
    <div style="font-size:14px;font-weight:700;color:var(--vp-c-text-1);margin-bottom:12px;">💬 讨论 / 评论</div>
    <div ref="container" />
  </div>
</template>
