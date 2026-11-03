<script setup lang="ts">
import { computed } from 'vue'
import { techIcon } from '@renderer/lib/techIcons'

const props = defineProps<{ name: string; size?: number }>()

const icon = computed(() => techIcon(props.name))
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
    class="shrink-0 dark:brightness-150"
    aria-hidden="true"
  >
    <path :d="icon.path" />
  </svg>
</template>
