<script setup lang="ts">
import { computed } from 'vue'
import {
  siAngular,
  siCplusplus,
  siDotnet,
  siElectron,
  siGo,
  siHtml5,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siOpenjdk,
  siPython,
  siReact,
  siRust,
  siSvelte,
  siTailwindcss,
  siTypescript,
  siVite,
  siVuedotjs
} from 'simple-icons'

const props = defineProps<{ name: string; size?: number }>()

/** 键是 main/services/tech.ts 给出的展示名 */
const ICONS: Record<string, { path: string; hex: string }> = {
  Electron: siElectron,
  'Next.js': siNextdotjs,
  Nuxt: siNuxt,
  Vue: siVuedotjs,
  React: siReact,
  Svelte: siSvelte,
  Angular: siAngular,
  TypeScript: siTypescript,
  Vite: siVite,
  Tailwind: siTailwindcss,
  'Node.js': siNodedotjs,
  Python: siPython,
  Go: siGo,
  Rust: siRust,
  Java: siOpenjdk,
  '.NET': siDotnet,
  'C/C++': siCplusplus,
  'HTML/JS': siHtml5
}

const icon = computed(() => ICONS[props.name])
// 品牌色接近黑色的图标跟随文字颜色，否则深色模式下看不见
const fill = computed(() => {
  const hex = icon.value?.hex
  if (!hex) return 'currentColor'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b < 40 ? 'currentColor' : `#${hex}`
})
</script>

<template>
  <svg
    v-if="icon"
    :width="size ?? 12"
    :height="size ?? 12"
    viewBox="0 0 24 24"
    :fill="fill"
    class="shrink-0"
    aria-hidden="true"
  >
    <path :d="icon.path" />
  </svg>
</template>
