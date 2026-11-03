<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Folder, GitBranch, Search } from 'lucide-vue-next'
import type { Project } from '@shared/types'
import TechIcon from '@renderer/components/TechIcon.vue'
import { branchLabel, rankProjects } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const MAX_RESULTS = 50

const store = useProjectsStore()
const router = useRouter()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const results = computed(() => rankProjects(store.projects, query.value).slice(0, MAX_RESULTS))

watch(query, () => {
  active.value = 0
})

function close(): void {
  store.quickJumpOpen = false
}

/** 有 Git 信息的进详情页，其他的只能在资源管理器里打开 */
function open(project: Project | undefined): void {
  if (!project) return
  close()
  if (project.git) void router.push({ name: 'repo', query: { path: project.path } })
  else if (!project.missing) void store.openInExplorer(project.path)
}

function openInEditor(project: Project | undefined): void {
  if (!project || project.missing) return
  close()
  void store.openInEditor(project.path)
}

async function move(step: number): Promise<void> {
  if (!results.value.length) return
  active.value = (active.value + step + results.value.length) % results.value.length
  await nextTick()
  list.value?.children[active.value]?.scrollIntoView({ block: 'nearest' })
}

function onEnter(event: KeyboardEvent): void {
  const project = results.value[active.value]
  if (event.ctrlKey) openInEditor(project)
  else open(project)
}

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="fixed inset-0 z-40 flex justify-center bg-black/30 pt-[12vh]" @click.self="close">
    <div
      role="dialog"
      aria-label="快速跳转"
      data-testid="quick-jump"
      class="flex h-fit max-h-[70vh] w-[36rem] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-800"
    >
      <label class="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-700">
        <Search :size="15" class="shrink-0 text-zinc-400" />
        <input
          ref="input"
          v-model="query"
          placeholder="输入项目名称、备注、路径或分支"
          aria-label="搜索要跳转的项目"
          class="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400 focus-visible:ring-0"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="onEnter"
          @keydown.esc.stop.prevent="close"
        />
      </label>

      <ul ref="list" class="min-h-0 flex-1 overflow-y-auto p-1">
        <li v-for="(project, index) in results" :key="project.path">
          <button
            class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left"
            :class="index === active ? 'bg-teal-100/70 dark:bg-teal-900/40' : ''"
            data-testid="quick-jump-item"
            @mousemove="active = index"
            @click="open(project)"
          >
            <span class="flex w-5 shrink-0 justify-center text-zinc-500 dark:text-zinc-300">
              <TechIcon v-if="project.tech[0]" :name="project.tech[0]" :size="15" />
              <Folder v-else :size="15" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ project.remark ?? project.name }}</span>
              <span class="block truncate text-xs text-zinc-500 dark:text-zinc-400">{{ project.path }}</span>
            </span>
            <span v-if="project.git" class="flex max-w-[9rem] shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
              <GitBranch :size="12" class="shrink-0" />
              <span class="truncate">{{ branchLabel(project.git) }}</span>
            </span>
          </button>
        </li>
        <li v-if="!results.length" class="py-8 text-center text-zinc-500">没有匹配的项目</li>
      </ul>

      <footer class="flex shrink-0 gap-4 border-t border-zinc-200 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        <span>↑↓ 选择</span>
        <span>Enter 打开</span>
        <span>Ctrl+Enter 用 VS Code 打开</span>
        <span>Esc 关闭</span>
      </footer>
    </div>
  </div>
</template>
