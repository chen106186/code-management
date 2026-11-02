<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert, FolderPlus, Plus, RefreshCw, Search, Settings, X } from 'lucide-vue-next'
import ProjectCard from '@renderer/components/ProjectCard.vue'
import SettingsDrawer from '@renderer/components/SettingsDrawer.vue'
import { FILTERS, type SortKind } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()
const settingsOpen = ref(false)

const SORTS: { kind: SortKind; label: string }[] = [
  { kind: 'activity', label: '最近活跃' },
  { kind: 'changes', label: '改动最多' },
  { kind: 'name', label: '名称' }
]

onMounted(() => {
  void store.refresh()
  window.addEventListener('focus', store.refreshOnFocus)
})
onBeforeUnmount(() => window.removeEventListener('focus', store.refreshOnFocus))
</script>

<template>
  <div class="flex h-full flex-col">
    <header
      class="flex shrink-0 flex-col gap-2.5 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700/70 dark:bg-zinc-800/40"
    >
      <div class="flex items-center gap-2">
        <h1 class="mr-2 text-sm font-semibold">代码管理</h1>
        <label class="relative min-w-0 flex-1">
          <Search
            :size="14"
            class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            v-model="store.query"
            type="search"
            placeholder="搜索名称、路径、分支、技术栈或标签"
            aria-label="搜索项目"
            class="field w-full pl-7"
          />
        </label>
        <button class="btn" :disabled="store.loading" @click="store.refresh()">
          <RefreshCw :size="14" :class="store.loading ? 'animate-spin' : ''" /> 刷新
        </button>
        <button class="btn" @click="store.addProject()"><Plus :size="14" /> 添加项目</button>
        <button class="btn" @click="settingsOpen = true"><Settings :size="14" /> 扫描设置</button>
      </div>

      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="{ kind, label } in FILTERS"
          :key="kind"
          class="rounded-md px-2 py-1 transition-colors"
          :class="
            store.filter === kind
              ? 'bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900'
              : 'text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-700'
          "
          :aria-pressed="store.filter === kind"
          @click="store.filter = kind"
        >
          {{ label }}
          <span class="ml-0.5 tabular-nums opacity-60">{{ store.filterCounts[kind] }}</span>
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
          排序
          <select v-model="store.sort" class="field h-7">
            <option v-for="{ kind, label } in SORTS" :key="kind" :value="kind">{{ label }}</option>
          </select>
        </label>
      </div>
    </header>

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

    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <p v-if="!store.loaded" class="py-16 text-center text-zinc-500">正在扫描项目…</p>

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
        没有符合条件的项目
      </p>

      <div
        v-else
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr))"
      >
        <ProjectCard v-for="project in store.visible" :key="project.path" :project="project" />
      </div>
    </main>

    <SettingsDrawer v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
