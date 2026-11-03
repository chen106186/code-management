<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CircleAlert,
  CloudDownload,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  X
} from 'lucide-vue-next'
import BranchPanel from '@renderer/components/repo/BranchPanel.vue'
import ChangesPanel from '@renderer/components/repo/ChangesPanel.vue'
import HistoryPanel from '@renderer/components/repo/HistoryPanel.vue'
import { useProjectsStore } from '@renderer/stores/projects'
import { useRepoStore, type RepoTab } from '@renderer/stores/repo'

const route = useRoute()
const router = useRouter()
const repo = useRepoStore()

const repoPath = computed(() => String(route.query.path ?? ''))
const repoName = computed(() => repoPath.value.split(/[\\/]/).filter(Boolean).pop() ?? '')
const projects = useProjectsStore()
const remark = computed(() => projects.projects.find((p) => p.path === repoPath.value)?.remark ?? null)
const status = computed(() => repo.changes?.status ?? null)
const branchLabel = computed(() => {
  const s = status.value
  if (!s) return ''
  return s.branch ?? `游离 ${s.head?.slice(0, 7) ?? ''}`
})
const changeCount = computed(() => {
  const c = repo.changes
  return c ? c.staged.length + c.unstaged.length + c.conflicted.length : 0
})

const tabs = computed<{ id: RepoTab; label: string }[]>(() => [
  { id: 'changes', label: changeCount.value ? `变更 ${changeCount.value}` : '变更' },
  { id: 'history', label: '历史' },
  { id: 'branches', label: '分支' }
])

const onFocus = (): void => void repo.refresh()
onMounted(() => {
  void repo.open(repoPath.value)
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  repo.close()
})
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex shrink-0 flex-col gap-2.5 border-b border-zinc-200 bg-white px-4 pt-3 dark:border-zinc-700/70 dark:bg-zinc-800/40"
    >
      <div class="flex items-center gap-2">
        <button class="icon-btn -ml-1" title="返回总览" aria-label="返回总览" @click="router.push('/')">
          <ArrowLeft :size="16" />
        </button>
        <div class="flex min-w-0 flex-1 items-baseline gap-2" :title="repoPath">
          <h1 class="min-w-0 truncate text-sm font-semibold">{{ remark ?? repoName }}</h1>
          <span v-if="remark" class="min-w-0 truncate text-xs text-zinc-400">{{ repoName }}</span>
        </div>
        <span v-if="status" class="flex min-w-0 items-center gap-1 font-medium" data-testid="current-branch">
          <GitBranch :size="13" class="shrink-0 text-zinc-400" />
          <span class="max-w-[12rem] truncate" :title="branchLabel">{{ branchLabel }}</span>
        </span>
        <span
          v-if="status?.ahead"
          class="flex items-center text-xs text-teal-700 dark:text-teal-400"
          :title="`领先上游 ${status.ahead} 个提交`"
          data-testid="ahead"
        >
          <ArrowUp :size="12" />{{ status.ahead }}
        </span>
        <span
          v-if="status?.behind"
          class="flex items-center text-xs text-amber-700 dark:text-amber-400"
          :title="`落后上游 ${status.behind} 个提交`"
          data-testid="behind"
        >
          <ArrowDown :size="12" />{{ status.behind }}
        </span>
        <button class="icon-btn" title="刷新" aria-label="刷新" @click="repo.refresh()">
          <RefreshCw :size="15" />
        </button>
        <button
          class="btn"
          :disabled="!!repo.fetching"
          title="从远程获取最新状态，不改动工作区和本地分支"
          @click="repo.fetchRemote()"
        >
          <CloudDownload :size="14" /> Fetch
        </button>
      </div>

      <nav class="-mb-px flex gap-1" aria-label="仓库视图">
        <button
          v-for="item in tabs"
          :key="item.id"
          class="border-b-2 px-2 pb-2 pt-0.5 transition-colors"
          :class="
            repo.tab === item.id
              ? 'border-teal-600 font-medium text-zinc-900 dark:text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          "
          :aria-current="repo.tab === item.id ? 'page' : undefined"
          @click="repo.tab = item.id"
        >
          {{ item.label }}
        </button>
      </nav>
    </header>

    <div
      v-if="repo.fetching"
      role="status"
      data-testid="remote-progress"
      class="flex shrink-0 items-center gap-2 bg-zinc-100 px-4 py-1.5 dark:bg-zinc-800"
    >
      <LoaderCircle :size="14" class="shrink-0 animate-spin text-zinc-500" />
      <span class="shrink-0">正在 Fetch</span>
      <span class="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{{ repo.fetching.line }}</span>
      <button class="btn h-6 text-xs" @click="repo.cancelFetch()">取消</button>
    </div>

    <div
      v-if="repo.error"
      role="alert"
      class="flex shrink-0 items-center gap-2 bg-red-50 px-4 py-2 text-red-700 dark:bg-red-950/50 dark:text-red-300"
    >
      <CircleAlert :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate" :title="repo.error">{{ repo.error }}</span>
      <button class="icon-btn" title="关闭" aria-label="关闭错误提示" @click="repo.error = null">
        <X :size="14" />
      </button>
    </div>

    <div
      v-else-if="repo.notice"
      role="status"
      data-testid="repo-notice"
      class="flex shrink-0 items-center gap-2 bg-teal-50 px-4 py-1 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300"
    >
      <span class="min-w-0 flex-1 truncate">{{ repo.notice }}</span>
      <button class="icon-btn" title="关闭" aria-label="关闭提示" @click="repo.notice = null">
        <X :size="14" />
      </button>
    </div>

    <main v-if="repo.changes" class="flex min-h-0 flex-1">
      <ChangesPanel v-if="repo.tab === 'changes'" />
      <HistoryPanel v-else-if="repo.tab === 'history'" />
      <BranchPanel v-else />
    </main>
    <p v-else-if="!repo.error" class="py-16 text-center text-zinc-500">正在读取仓库…</p>
  </div>
</template>
