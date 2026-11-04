<script setup>
import { onMounted } from 'vue'

const client = __ADSENSE_CLIENT__
const slot = __ADSENSE_AD_SLOT__
const enabled = Boolean(client && slot)

onMounted(() => {
  if (!enabled || typeof window === 'undefined') return
  try {
    ;(window.adsbygoogle = window.adsbygoogle || []).push({})
  } catch {}
})
</script>

<template>
  <div v-if="enabled" class="welink-ad" aria-label="Advertisement">
    <span class="welink-ad-label">Advertisement</span>
    <ins
      class="adsbygoogle"
      style="display:block;text-align:center;"
      data-ad-layout="in-article"
      data-ad-format="fluid"
      :data-ad-client="client"
      :data-ad-slot="slot"
    />
  </div>
</template>
