<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Check, ChevronDown, Cloud, GitBranch, LoaderCircle, Search, TriangleAlert } from 'lucide-vue-next'
import { switchableBranches } from '@shared/branches'
import type { Branch } from '@shared/repo'
import type { Project } from '@shared/types'
import { errorMessage } from '@renderer/lib/errors'
import { changeCount } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const props = defineProps<{ project: Project; label: string }>()
const store = useProjectsStore()

const MENU_WIDTH = 288
const MENU_MAX_HEIGHT = 340
const MARGIN = 8

const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)

const open = ref(false)
const switching = ref(false)
const loading = ref(false)
const failure = ref<string | null>(null)
const branches = ref<Branch[]>([])
const query = ref('')
const menuStyle = ref<Record<string, string>>({})

const matches = (branch: Branch): boolean =>
  branch.name.toLowerCase().includes(query.value.trim().toLowerCase())
const lists = computed(() => switchableBranches(branches.value))
const local = computed(() => lists.value.local.filter(matches))
const remote = computed(() => lists.value.remote.filter(matches))
const dirty = computed(() => changeCount(props.project.git) > 0)
/** 尚无提交的仓库没有可切换的分支 */
const disabled = computed(() => !props.project.git?.head || switching.value)

/** 菜单挂在 body 上，避免被滚动区域裁剪；下方放不下时向上展开 */
function placeMenu(): void {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - MENU_WIDTH - MARGIN))
  const below = window.innerHeight - rect.bottom - MARGIN
  menuStyle.value =
    below >= MENU_MAX_HEIGHT || below >= rect.top
      ? { left: `${left}px`, top: `${rect.bottom + 4}px`, maxHeight: `${Math.min(below - 4, MENU_MAX_HEIGHT)}px` }
      : {
          left: `${left}px`,
          bottom: `${window.innerHeight - rect.top + 4}px`,
          maxHeight: `${Math.min(rect.top - MARGIN - 4, MENU_MAX_HEIGHT)}px`
        }
}

function onOutsidePointer(event: PointerEvent): void {
  const target = event.target as Node
  if (!menu.value?.contains(target) && !trigger.value?.contains(target)) closeMenu()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    closeMenu()
    trigger.value?.focus()
  }
}

function addListeners(): void {
  document.addEventListener('pointerdown', onOutsidePointer)
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', closeMenu)
  // 捕获阶段才能收到内部滚动区域的滚动；菜单自身的滚动不算
  window.addEventListener('scroll', onScroll, true)
}

function removeListeners(): void {
  document.removeEventListener('pointerdown', onOutsidePointer)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', closeMenu)
  window.removeEventListener('scroll', onScroll, true)
}

function onScroll(event: Event): void {
  if (!menu.value?.contains(event.target as Node)) closeMenu()
}

function closeMenu(): void {
  open.value = false
  removeListeners()
}

async function openMenu(): Promise<void> {
  query.value = ''
  failure.value = null
  loading.value = true
  branches.value = []
  placeMenu()
  open.value = true
  addListeners()
  await nextTick()
  filterInput.value?.focus()
  try {
    branches.value = await window.api.getBranches(props.project.path)
  } catch (e) {
    failure.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

function toggle(): void {
  if (open.value) closeMenu()
  else void openMenu()
}

async function choose(branch: Branch): Promise<void> {
  closeMenu()
  if (branch.current) return
  switching.value = true
  await store.switchBranch(props.project.path, branch)
  switching.value = false
}

/** 筛选后回车直接切到第一个匹配项 */
function chooseFirst(): void {
  const first = local.value.find((b) => !b.current) ?? remote.value[0]
  if (first) void choose(first)
}

onBeforeUnmount(removeListeners)
</script>

<template>
  <button
    ref="trigger"
    class="-mx-1 flex min-w-0 items-center gap-1 rounded px-1 py-0.5 font-medium text-zinc-800 hover:bg-zinc-100 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-700"
    :title="project.git?.head ? '切换分支' : '提交之后才能切换分支'"
    aria-haspopup="true"
    :aria-expanded="open"
    aria-label="切换分支"
    :disabled="disabled"
    data-testid="branch-switcher"
    @click="toggle"
  >
    <LoaderCircle v-if="switching" :size="13" class="shrink-0 animate-spin text-zinc-400" />
    <GitBranch v-else :size="13" class="shrink-0 text-zinc-400" />
    <span class="max-w-[12rem] truncate">{{ label }}</span>
    <ChevronDown v-if="project.git?.head" :size="12" class="shrink-0 text-zinc-400" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="menu"
      class="fixed z-30 flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      :style="{ ...menuStyle, width: `${MENU_WIDTH}px` }"
      data-testid="branch-menu"
    >
      <label class="relative block shrink-0 border-b border-zinc-100 p-1.5 dark:border-zinc-700">
        <Search :size="13" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          ref="filterInput"
          v-model="query"
          placeholder="筛选分支"
          aria-label="筛选分支"
          class="field h-7 w-full pl-6 text-xs"
          @keydown.enter.prevent="chooseFirst"
        />
      </label>

      <p
        v-if="dirty"
        class="flex shrink-0 items-start gap-1.5 bg-amber-50 px-2.5 py-1.5 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
      >
        <TriangleAlert :size="12" class="mt-px shrink-0" />
        有未提交的改动，它们会带到新分支；会被覆盖时 Git 会拒绝切换，改动不会丢。
      </p>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <p v-if="loading" class="px-3 py-2 text-zinc-500">正在读取分支…</p>
        <p v-else-if="failure" class="break-all px-3 py-2 text-red-600 dark:text-red-400">{{ failure }}</p>
        <p v-else-if="!local.length && !remote.length" class="px-3 py-2 text-zinc-500">没有匹配的分支</p>

        <template v-if="local.length">
          <h4 class="px-3 py-1 font-semibold text-zinc-500 dark:text-zinc-400">本地分支</h4>
          <button
            v-for="branch in local"
            :key="branch.name"
            class="flex h-7 w-full items-center gap-1.5 px-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
            :class="branch.current ? 'font-medium text-teal-700 dark:text-teal-400' : ''"
            :title="branch.name"
            data-testid="branch-option"
            @click="choose(branch)"
          >
            <Check v-if="branch.current" :size="13" class="shrink-0" />
            <GitBranch v-else :size="13" class="shrink-0 text-zinc-400" />
            <span class="min-w-0 flex-1 truncate">{{ branch.name }}</span>
            <span v-if="branch.ahead" class="shrink-0 tabular-nums text-teal-700 dark:text-teal-400">↑{{ branch.ahead }}</span>
            <span v-if="branch.behind" class="shrink-0 tabular-nums text-amber-700 dark:text-amber-400">↓{{ branch.behind }}</span>
          </button>
        </template>

        <template v-if="remote.length">
          <h4 class="px-3 py-1 font-semibold text-zinc-500 dark:text-zinc-400">远程分支</h4>
          <button
            v-for="branch in remote"
            :key="branch.name"
            class="flex h-7 w-full items-center gap-1.5 px-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-700"
            :title="`签出 ${branch.name}，并创建同名本地分支`"
            data-testid="branch-option"
            @click="choose(branch)"
          >
            <Cloud :size="13" class="shrink-0 text-zinc-400" />
            <span class="min-w-0 flex-1 truncate">{{ branch.name }}</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>
