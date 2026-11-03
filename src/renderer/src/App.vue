<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import QuickJump from '@renderer/components/QuickJump.vue'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()
const route = useRoute()

/** 用捕获阶段，否则焦点在 Diff 编辑器里时按键会被 Monaco 拿走 */
function onKey(event: KeyboardEvent): void {
  if (!event.ctrlKey || event.key.toLowerCase() !== 'k' || !store.loaded) return
  event.preventDefault()
  event.stopPropagation()
  store.quickJumpOpen = !store.quickJumpOpen
}

// 主进程只接受已登记的路径，所以要等首次扫描完成后再显示页面
onMounted(() => {
  void store.refresh()
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <template v-if="store.loaded">
    <!-- 仓库页只在挂载时读取路径，从一个仓库跳到另一个时要重建 -->
    <RouterView :key="route.fullPath" />
    <QuickJump v-if="store.quickJumpOpen" />
  </template>
  <p v-else class="py-16 text-center text-zinc-500">正在扫描项目…</p>
</template>
