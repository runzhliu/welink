import DefaultTheme from 'vitepress/theme'
import { onMounted, watch, nextTick, h } from 'vue'
import { useRoute } from 'vitepress'
import mediumZoom from 'medium-zoom'
import GiscusComments from './GiscusComments.vue'
import './custom.css'

// ── 滚动淡入：给常见内容容器加 .welink-fade-in，进入视口后加 .is-visible ──
function initFadeIn() {
  // 只观察文档区域（避免影响 nav/sidebar/footer 自身组件）
  const roots = document.querySelectorAll('.vp-doc, .VPHome')
  if (roots.length === 0) return () => {}

  const targets = new Set()
  roots.forEach(r => {
    // 常见想要动效的元素
    r.querySelectorAll('h2, h3, .feat-card, .VPFeature, details, table, blockquote, .welink-marquee').forEach(el => targets.add(el))
    // "auto" 策略：2 列 grid 的直系子元素（首页 features）加 stagger
    r.querySelectorAll('.feat-grid, .VPFeatures .items').forEach(el => {
      el.classList.add('welink-fade-in-stagger')
      targets.add(el)
    })
  })

  targets.forEach(el => el.classList.add('welink-fade-in'))

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible')
        io.unobserve(e.target)  // 一次性：进入后不再反复
      }
    }
  }, { rootMargin: '-6% 0px -4% 0px', threshold: 0.05 })

  targets.forEach(el => io.observe(el))
  return () => io.disconnect()
}

// ── 数字 count-up：给 <span class="welink-countup" data-to="100"> 做计数动画 ──
function initCountUp() {
  const nodes = document.querySelectorAll('.welink-countup[data-to]')
  if (nodes.length === 0) return () => {}
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const el = e.target
      io.unobserve(el)
      const to = parseFloat(el.getAttribute('data-to') || '0')
      const dur = parseInt(el.getAttribute('data-dur') || '1200', 10)
      const prefix = el.getAttribute('data-prefix') || ''
      const suffix = el.getAttribute('data-suffix') || ''
      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / dur)
        const ease = 1 - Math.pow(1 - t, 3)  // easeOutCubic
        const v = Math.round(to * ease)
        el.textContent = prefix + v.toLocaleString() + suffix
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }
  }, { threshold: 0.4 })
  nodes.forEach(n => { n.textContent = n.getAttribute('data-prefix') || '0'; io.observe(n) })
  return () => io.disconnect()
}

// ── 浮动吉祥物 ──
let mascotEl = null
function mountMascot() {
  if (mascotEl || typeof document === 'undefined') return
  mascotEl = document.createElement('button')
  mascotEl.className = 'welink-mascot'
  mascotEl.setAttribute('data-tip', '点我回到顶部 ⇧')
  mascotEl.setAttribute('aria-label', '回到顶部')
  mascotEl.textContent = '💬'
  mascotEl.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
  document.body.appendChild(mascotEl)
}

// ── 顶部滚动进度条 ──
let progressEl = null
let progressHandler = null
function mountScrollProgress() {
  if (progressEl || typeof document === 'undefined') return
  progressEl = document.createElement('div')
  progressEl.className = 'welink-scroll-progress'
  progressEl.setAttribute('aria-hidden', 'true')
  document.body.appendChild(progressEl)
  const update = () => {
    const doc = document.documentElement
    const scrollTop = window.scrollY || doc.scrollTop
    const max = Math.max(1, (doc.scrollHeight - doc.clientHeight))
    const ratio = Math.min(1, Math.max(0, scrollTop / max))
    progressEl.style.transform = `scaleX(${ratio})`
  }
  progressHandler = () => requestAnimationFrame(update)
  window.addEventListener('scroll', progressHandler, { passive: true })
  window.addEventListener('resize', progressHandler, { passive: true })
  update()
}

// ── 视频懒加载：.welink-lazy-video 点击后才播放（preload="none" 避免预下载） ──
function initLazyVideos() {
  const wraps = document.querySelectorAll('.welink-lazy-video')
  if (wraps.length === 0) return () => {}
  const handlers = []
  wraps.forEach(wrap => {
    const video = wrap.querySelector('video')
    if (!video) return
    const onClick = (e) => {
      // 若已在播放，点击走 zoom 行为（跳出到顶层 overlay）
      if (wrap.classList.contains('is-playing')) {
        if (typeof window.zoomVideo === 'function') window.zoomVideo(video.currentSrc || video.src)
        return
      }
      wrap.classList.add('is-playing')
      // 第一次点击：切到 auto 加载 + 播放
      video.preload = 'auto'
      video.play().catch(() => {
        // 某些浏览器需要用户手势，但这里本身就是 click，可安全忽略
      })
    }
    wrap.addEventListener('click', onClick)
    handlers.push(() => wrap.removeEventListener('click', onClick))
  })
  return () => handlers.forEach(h => h())
}

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'doc-after': () => h(GiscusComments),
    })
  },
  setup() {
    const route = useRoute()

    const initZoom = () => {
      mediumZoom('.vp-doc img', {
        background: 'rgba(0,0,0,0.8)',
        margin: 24,
      })
    }

    let disposeFade = () => {}
    let disposeCount = () => {}
    let disposeLazyVid = () => {}

    const init = () => {
      initZoom()
      disposeFade()
      disposeCount()
      disposeLazyVid()
      disposeFade = initFadeIn()
      disposeCount = initCountUp()
      disposeLazyVid = initLazyVideos()
    }

    onMounted(() => {
      init()
      mountMascot()
      mountScrollProgress()
    })
    watch(() => route.path, () => nextTick(init))
  },
}
