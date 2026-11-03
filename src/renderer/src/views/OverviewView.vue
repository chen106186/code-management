<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowUpDown,
  CircleAlert,
  CloudDownload,
  FolderMinus,
  FolderPlus,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  X
} from 'lucide-vue-next'
import BatchBar from '@renderer/components/BatchBar.vue'
import BoardStats from '@renderer/components/BoardStats.vue'
import CategorySidebar from '@renderer/components/CategorySidebar.vue'
import HiddenProjects from '@renderer/components/HiddenProjects.vue'
import MoveSuggestions from '@renderer/components/MoveSuggestions.vue'
import ProjectCard from '@renderer/components/ProjectCard.vue'
import ProjectRow from '@renderer/components/ProjectRow.vue'
import SettingsDrawer from '@renderer/components/SettingsDrawer.vue'
import { FILTERS, SCOPE_HIDDEN, type SortKind, type ViewMode } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()
const settingsOpen = ref(false)

const FILTER_ICONS: Record<string, typeof Star> = {
  all: LayoutGrid,
  favorite: Star,
  nonGit: FolderMinus
}

const VIEWS: { mode: ViewMode; label: string; icon: typeof Star }[] = [
  { mode: 'cards', label: '卡片视图', icon: LayoutGrid },
  { mode: 'list', label: '列表视图', icon: List }
]

const SORTS: { kind: SortKind; label: string }[] = [
  { kind: 'activity', label: '最近活跃' },
  { kind: 'changes', label: '改动最多' },
  { kind: 'name', label: '名称' }
]

const fetchSummaryText = computed(() => {
  const summary = store.fetchSummary
  if (!summary) return ''
  if (summary.cancelled) return `已取消，完成了 ${summary.succeeded} 个仓库的 Fetch`
  if (!summary.failed.length) return `已 Fetch ${summary.succeeded} 个仓库`
  return `已 Fetch ${summary.succeeded} 个仓库，${summary.failed.length} 个失败`
})

const showBatchBar = computed(
  () => store.scope !== SCOPE_HIDDEN && store.selectedPaths.length > 0
)

const onFocus = (): void => store.refreshIfStale()
/** 弹层和输入框自己处理 Esc，这些情况下不清空选择 */
const onKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || settingsOpen.value) return
  if ((event.target as Element).closest('input, select')) return
  store.clearSelection()
}
onMounted(() => {
  // 从仓库页返回时状态可能已变化
  store.refreshIfStale(2000)
  window.addEventListener('focus', onFocus)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="flex h-full">
    <CategorySidebar />
    <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="flex shrink-0 flex-col gap-2.5 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700/70 dark:bg-zinc-800/40"
    >
      <div class="flex items-center gap-2">
        <label class="relative min-w-0 flex-1">
          <Search
            :size="14"
            class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            v-model="store.query"
            type="search"
            placeholder="搜索名称、备注、路径、分支、技术栈或标签"
            aria-label="搜索项目"
            class="field w-full pl-7 pr-16"
          />
          <button
            class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-zinc-300 px-1.5 text-[11px] leading-5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-700"
            title="快速跳转到项目"
            data-testid="quick-jump-open"
            @click.prevent="store.quickJumpOpen = true"
          >
            Ctrl K
          </button>
        </label>
        <button class="btn" :disabled="store.loading" @click="store.refresh()">
          <RefreshCw :size="14" :class="store.loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button v-if="store.fetching" class="btn" @click="store.cancelFetchAll()">
          <X :size="14" /> 取消 {{ store.fetchProgress }}
        </button>
        <button
          v-else
          class="btn"
          title="对列表中所有配置了远程的仓库运行 git fetch"
          @click="store.fetchAll()"
        >
          <CloudDownload :size="14" /> 全部 Fetch
        </button>
        <button class="btn" @click="store.addProject()"><Plus :size="14" /> 添加项目</button>
        <button class="btn" @click="settingsOpen = true"><Settings :size="14" /> 设置</button>
      </div>

      <BoardStats v-if="store.scope !== SCOPE_HIDDEN && store.projects.length" />

      <h2 v-if="store.scope === SCOPE_HIDDEN" class="flex h-7 items-center gap-1.5 font-semibold">
        已隐藏的项目
        <span class="text-xs font-normal tabular-nums text-zinc-500">{{ store.hiddenProjects.length }}</span>
      </h2>
      <div v-else class="flex flex-wrap items-center gap-1">
        <button
          v-for="{ kind, label } in FILTERS"
          :key="kind"
          class="inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors"
          :class="
            store.filter === kind
              ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
              : 'text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-700'
          "
          :aria-pressed="store.filter === kind"
          @click="store.filter = kind"
        >
          <component :is="FILTER_ICONS[kind]" :size="13" />
          {{ label }}
          <span class="tabular-nums opacity-60">{{ store.filterCounts[kind] }}</span>
        </button>

        <select
          v-if="store.allTags.length"
          v-model="store.activeTag"
          aria-label="按标签筛选"
          class="field ml-1 h-7"
        >
          <option :value="null">所有标签</option>
          <option v-for="tag in store.allTags" :key="tag" :value="tag">{{ tag }}</option>
        </select>

        <label class="ml-auto flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
          <ArrowUpDown :size="13" />
          <span class="sr-only">排序</span>
          <select v-model="store.sort" class="field h-7">
            <option v-for="{ kind, label } in SORTS" :key="kind" :value="kind">{{ label }}</option>
          </select>
        </label>

        <div role="radiogroup" aria-label="视图" class="ml-1 flex rounded-md bg-zinc-200/70 p-0.5 dark:bg-zinc-900/60">
          <button
            v-for="view in VIEWS"
            :key="view.mode"
            role="radio"
            :aria-checked="store.viewMode === view.mode"
            :aria-label="view.label"
            :title="view.label"
            :data-testid="`view-${view.mode}`"
            class="flex h-6 w-7 items-center justify-center rounded transition-colors"
            :class="
              store.viewMode === view.mode
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            "
            @click="store.viewMode = view.mode"
          >
            <component :is="view.icon" :size="14" />
          </button>
        </div>
      </div>
    </header>

    <MoveSuggestions v-if="store.moves.length" />
    <BatchBar v-if="showBatchBar" />

    <div
      v-if="store.error"
      role="alert"
      class="flex shrink-0 items-center gap-2 bg-red-50 px-4 py-2 text-red-700 dark:bg-red-950/50 dark:text-red-300"
    >
      <CircleAlert :size="14" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate" :title="store.error">{{ store.error }}</span>
      <button class="icon-btn" title="关闭" aria-label="关闭错误提示" @click="store.error = null">
        <X :size="14" />
      </button>
    </div>

    <div
      v-if="store.fetchSummary"
      role="status"
      data-testid="fetch-summary"
      class="flex shrink-0 items-start gap-2 border-b border-zinc-200 bg-zinc-100 px-4 py-2 dark:border-zinc-700/70 dark:bg-zinc-800"
    >
      <div class="min-w-0 flex-1">
        <p>{{ fetchSummaryText }}</p>
        <p
          v-for="item in store.fetchSummary.failed"
          :key="item.path"
          class="truncate text-xs text-red-600 dark:text-red-400"
          :title="item.message"
        >
          {{ item.name }}：{{ item.message }}
        </p>
      </div>
      <button class="icon-btn" title="关闭" aria-label="关闭结果" @click="store.fetchSummary = null">
        <X :size="14" />
      </button>
    </div>

    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <HiddenProjects v-if="store.scope === SCOPE_HIDDEN" />

      <div
        v-else-if="!store.projects.length"
        class="mx-auto flex max-w-sm flex-col items-center gap-3 py-20 text-center"
      >
        <h2 class="text-base font-semibold">添加一个代码目录开始使用</h2>
        <p class="text-zinc-500 dark:text-zinc-400">
          选择存放项目的文件夹，会自动找出其中的项目，并显示分支和改动情况。
        </p>
        <button class="btn btn-primary" @click="store.addRoot()">
          <FolderPlus :size="14" /> 添加根目录
        </button>
      </div>

      <p v-else-if="!store.visible.length" class="py-16 text-center text-zinc-500">
        {{
          store.scopedProjects.length
            ? '没有符合条件的项目'
            : '这里还没有项目，可以把卡片拖到左侧分类，或在卡片上选择分类'
        }}
      </p>

      <ul
        v-else-if="store.viewMode === 'list'"
        class="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-700/50 dark:border-zinc-700/70 dark:bg-zinc-800/60"
        data-testid="project-list"
      >
        <ProjectRow v-for="project in store.visible" :key="project.path" :project="project" />
      </ul>

      <div
        v-else
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr))"
      >
        <ProjectCard v-for="project in store.visible" :key="project.path" :project="project" />
      </div>
    </main>
    </div>

    <SettingsDrawer v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
