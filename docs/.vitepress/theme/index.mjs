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
  mascotEl.textContent = '🐿️'
  mascotEl.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))
  document.body.appendChild(mascotEl)
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

    const init = () => {
      initZoom()
      disposeFade()
      disposeCount()
      disposeFade = initFadeIn()
      disposeCount = initCountUp()
    }

    onMounted(() => {
      init()
      mountMascot()
    })
    watch(() => route.path, () => nextTick(init))
  },
}
