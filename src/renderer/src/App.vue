<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { FolderGit2 } from 'lucide-vue-next'
import QuickJump from '@renderer/components/QuickJump.vue'
import { useProjectsStore } from '@renderer/stores/projects'
import type { ScanProgress } from '@shared/types'

const store = useProjectsStore()
const route = useRoute()
const progress = ref<ScanProgress>({ done: 0, total: null, current: null })
const percent = computed(() => {
  const { done, total } = progress.value
  return total === null ? null : total === 0 ? 100 : Math.min(100, Math.round((done / total) * 100))
})
let unlisten: (() => void) | undefined
let unmounted = false

/** 用捕获阶段，否则焦点在 Diff 编辑器里时按键会被 Monaco 拿走 */
function onKey(event: KeyboardEvent): void {
  if (!event.ctrlKey || event.key.toLowerCase() !== 'k' || !store.loaded) return
  event.preventDefault()
  event.stopPropagation()
  store.quickJumpOpen = !store.quickJumpOpen
}

// 主进程只接受已登记的路径，所以要等首次扫描完成后再显示页面
onMounted(async () => {
  window.addEventListener('keydown', onKey, true)
  try {
    const stop = await window.api.onScanProgress((value) => { progress.value = value })
    if (unmounted) {
      stop()
      return
    }
    unlisten = stop
  } catch {
    // 进度监听不可用时仍然继续加载项目。
  }
  if (!unmounted) await store.refresh()
})
onBeforeUnmount(() => {
  unmounted = true
  unlisten?.()
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <template v-if="store.loaded">
    <!-- 仓库页只在挂载时读取路径，从一个仓库跳到另一个时要重建 -->
    <RouterView :key="route.fullPath" />
    <QuickJump v-if="store.quickJumpOpen" />
  </template>
  <main v-else class="loading-page" aria-busy="true">
    <section class="loading-content" aria-labelledby="loading-title">
      <div class="loading-icon" aria-hidden="true"><FolderGit2 :size="30" :stroke-width="1.6" /></div>
      <p class="loading-brand">CODE MANAGEMENT</p>
      <h1 id="loading-title">正在准备你的项目</h1>
      <p class="loading-description">扫描本地目录，整理项目与仓库信息</p>

      <div class="loading-progress">
        <div class="loading-progress-label">
          <span>{{ percent === null ? '正在查找项目' : '正在读取项目信息' }}</span>
          <span v-if="percent !== null" class="loading-count">{{ progress.done }} / {{ progress.total }}</span>
        </div>
        <div
          class="loading-track"
          role="progressbar"
          aria-label="项目扫描进度"
          :aria-valuenow="percent === null ? undefined : percent"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div v-if="percent === null" class="loading-indeterminate" />
          <div v-else class="loading-fill" :style="{ transform: `scaleX(${percent / 100})` }" />
        </div>
        <p class="loading-detail" :title="progress.current ?? undefined">
          {{ progress.current ? `已读取 ${progress.current}` : percent === null ? '正在查找已添加的目录' : '正在整理扫描结果' }}
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.loading-page { position: relative; isolation: isolate; min-height: 100%; display: grid; place-items: center; overflow: hidden; padding: 32px; background: #f8fafb; }
.loading-page::before, .loading-page::after { position: absolute; z-index: -1; pointer-events: none; content: ''; }
.loading-page::before { inset: 0; background-image: linear-gradient(rgb(13 148 136 / .07) 1px, transparent 1px), linear-gradient(90deg, rgb(13 148 136 / .07) 1px, transparent 1px); background-size: 48px 48px; mask-image: radial-gradient(ellipse at center, #000 10%, transparent 78%); }
.loading-page::after { inset: -30%; background: radial-gradient(ellipse at 28% 30%, rgb(45 212 191 / .15), transparent 32%), radial-gradient(ellipse at 72% 70%, rgb(56 189 248 / .11), transparent 34%); animation: ambient-drift 16s ease-in-out infinite alternate; }
.loading-content { width: min(100%, 360px); text-align: center; }
.loading-icon { display: grid; place-items: center; width: 68px; height: 68px; margin: 0 auto 25px; border: 1px solid rgb(153 246 228 / .7); border-radius: 20px; color: #0f766e; background: #f0fdfa; }
.loading-brand { margin: 0 0 10px; color: #0f766e; font-size: 10px; font-weight: 700; letter-spacing: .16em; }
h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
.loading-description { margin: 10px 0 0; color: #71717a; font-size: 13px; }
.loading-progress { margin-top: 38px; text-align: left; }
.loading-progress-label { display: flex; justify-content: space-between; gap: 12px; color: #52525b; font-size: 12px; font-weight: 500; }
.loading-count { color: #71717a; font-variant-numeric: tabular-nums; }
.loading-track { height: 6px; margin-top: 11px; overflow: hidden; border-radius: 999px; background: #e4e4e7; }
.loading-fill, .loading-indeterminate { height: 100%; border-radius: inherit; background: #0d9488; }
.loading-fill { transform-origin: left; transition: transform 220ms cubic-bezier(.23, 1, .32, 1); }
.loading-indeterminate { width: 38%; animation: scan 1.6s ease-in-out infinite; }
.loading-detail { min-height: 18px; margin: 11px 0 0; overflow: hidden; color: #a1a1aa; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
@keyframes scan { from { transform: translateX(-100%); } to { transform: translateX(265%); } }
@keyframes ambient-drift { from { transform: translate3d(-3%, -2%, 0); } to { transform: translate3d(3%, 2%, 0); } }
@media (prefers-color-scheme: dark) {
  .loading-page { background: #18181b; }
  .loading-page::before { background-image: linear-gradient(rgb(94 234 212 / .07) 1px, transparent 1px), linear-gradient(90deg, rgb(94 234 212 / .07) 1px, transparent 1px); }
  .loading-page::after { background: radial-gradient(ellipse at 28% 30%, rgb(13 148 136 / .17), transparent 32%), radial-gradient(ellipse at 72% 70%, rgb(14 116 144 / .14), transparent 34%); }
  .loading-icon { border-color: #134e4a; color: #5eead4; background: #134e4a80; }
  .loading-brand { color: #5eead4; }
  .loading-description, .loading-count { color: #a1a1aa; }
  .loading-progress-label { color: #d4d4d8; }
  .loading-track { background: #3f3f46; }
  .loading-fill, .loading-indeterminate { background: #2dd4bf; }
  .loading-detail { color: #a1a1aa; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-page::after { animation: none; }
  .loading-indeterminate { animation: none; opacity: .7; }
  .loading-fill { transition: none; }
}
</style>
