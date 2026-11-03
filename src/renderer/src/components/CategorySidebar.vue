<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  Folder,
  FolderPlus,
  Inbox,
  Layers,
  Monitor,
  Moon,
  Pencil,
  Sun,
  Trash2
} from 'lucide-vue-next'
import type { ThemeSetting } from '@shared/types'
import {
  flattenCategories,
  resolveDrop,
  subtreeIds,
  type CategoryRow,
  type DropPosition
} from '@shared/categories'
import logo from '@renderer/assets/logo.png'
import { CATEGORY_DRAG_TYPE, PROJECT_DRAG_TYPE } from '@renderer/lib/projectDrag'
import { SCOPE_ALL, SCOPE_HIDDEN, SCOPE_UNCATEGORIZED } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

const THEMES: { value: ThemeSetting; label: string; title: string; icon: typeof Sun }[] = [
  { value: 'system', label: '系统', title: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', title: '浅色模式', icon: Sun },
  { value: 'dark', label: '深色', title: '深色模式', icon: Moon }
]

const INDENT_PX = 14
const BASE_PADDING_PX = 8

const rows = computed(() => flattenCategories(store.categories, store.collapsed))

type Editing = { mode: 'create'; parentId: string | null } | { mode: 'rename'; id: string }
const editing = ref<Editing | null>(null)
const draft = ref('')
const input = ref<HTMLInputElement | HTMLInputElement[] | null>(null)

async function startEditing(next: Editing, initial = ''): Promise<void> {
  editing.value = next
  draft.value = initial
  if (next.mode === 'create' && next.parentId) store.expand(next.parentId)
  await nextTick()
  const element = Array.isArray(input.value) ? input.value[0] : input.value
  element?.focus()
  element?.select()
}

function cancelEditing(): void {
  editing.value = null
}

let saving = false

async function commitEditing(): Promise<void> {
  const current = editing.value
  if (!current || saving) return
  const name = draft.value.trim()
  if (!name) return cancelEditing()
  saving = true
  const ok =
    current.mode === 'create'
      ? await store.createCategory(name, current.parentId)
      : await store.renameCategory(current.id, name)
  saving = false
  // 失败时（比如重名）保留输入框，错误提示在页面顶部
  if (ok) cancelEditing()
}

const isCreatingUnder = (parentId: string | null): boolean =>
  editing.value?.mode === 'create' && editing.value.parentId === parentId
const isRenaming = (id: string): boolean => editing.value?.mode === 'rename' && editing.value.id === id

const dropTarget = ref<string | null>(null)

function onDragOver(event: DragEvent, target: string): void {
  if (!event.dataTransfer?.types.includes(PROJECT_DRAG_TYPE)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTarget.value = target
}

function onDrop(event: DragEvent, categoryId: string | null): void {
  const path = event.dataTransfer?.getData(PROJECT_DRAG_TYPE)
  dropTarget.value = null
  if (!path) return
  event.preventDefault()
  void store.setProjectCategory(path, categoryId)
}

/** 行的上下四分之一是排序，中间是放进文件夹 */
const EDGE_RATIO = 0.25

const draggingId = ref<string | null>(null)
const insertLine = ref<{ id: string; position: 'before' | 'after' } | null>(null)
const overRootEnd = ref(false)

/** 自己和自己的子孙不能作为目标，否则会形成环 */
const draggingSubtree = computed(() =>
  draggingId.value ? subtreeIds(store.categories, draggingId.value) : new Set<string>()
)

function clearCategoryDrag(): void {
  draggingId.value = null
  insertLine.value = null
  dropTarget.value = null
  overRootEnd.value = false
}

function onCategoryDragStart(event: DragEvent, id: string): void {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(CATEGORY_DRAG_TYPE, id)
  event.dataTransfer.effectAllowed = 'move'
  draggingId.value = id
}

function dropPositionOf(event: DragEvent): DropPosition {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  if (ratio < EDGE_RATIO) return 'before'
  if (ratio > 1 - EDGE_RATIO) return 'after'
  return 'inside'
}

function onRowDragOver(event: DragEvent, id: string): void {
  if (!draggingId.value) return onDragOver(event, id)
  if (draggingSubtree.value.has(id) || !event.dataTransfer) {
    insertLine.value = null
    dropTarget.value = null
    return
  }
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const position = dropPositionOf(event)
  insertLine.value = position === 'inside' ? null : { id, position }
  dropTarget.value = position === 'inside' ? id : null
}

function onRowDragLeave(event: DragEvent): void {
  // 在行内的子元素之间移动也会触发 dragleave，不处理的话提示会闪烁
  if ((event.currentTarget as Node).contains(event.relatedTarget as Node | null)) return
  dropTarget.value = null
  insertLine.value = null
}

async function moveTo(parentId: string | null, beforeId: string | null): Promise<void> {
  const id = draggingId.value
  clearCategoryDrag()
  if (!id) return
  if (await store.moveCategory(id, parentId, beforeId)) {
    if (parentId) store.expand(parentId)
  }
}

function onRowDrop(event: DragEvent, id: string): void {
  if (!draggingId.value) return onDrop(event, id)
  if (draggingSubtree.value.has(id)) return clearCategoryDrag()
  event.preventDefault()
  const target = resolveDrop(store.categories, store.collapsed, id, dropPositionOf(event))
  if (target) void moveTo(target.parentId, target.beforeId)
  else clearCategoryDrag()
}

function onRootEndDragOver(event: DragEvent): void {
  if (!draggingId.value || !event.dataTransfer) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  overRootEnd.value = true
}

function onRootEndDrop(event: DragEvent): void {
  event.preventDefault()
  void moveTo(null, null)
}

/** 插入线对齐到放下后的层级；展开的文件夹下边缘对应它的子级 */
function insertLineLeft(row: CategoryRow): number {
  const opensIntoChildren =
    insertLine.value?.position === 'after' &&
    row.hasChildren &&
    !store.collapsed.has(row.category.id)
  return (row.depth + (opensIntoChildren ? 1 : 0)) * INDENT_PX + BASE_PADDING_PX
}

const rowClass = (scope: string): string =>
  [
    store.scope === scope
      ? 'bg-teal-100/70 font-medium text-teal-900 dark:bg-teal-900/40 dark:text-teal-200'
      : 'text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-700/50',
    dropTarget.value === scope ? 'ring-2 ring-inset ring-teal-500' : ''
  ].join(' ')
</script>

<template>
  <aside
    aria-label="项目分类"
    class="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/70 dark:border-zinc-700/70 dark:bg-zinc-800/70"
  >
    <header class="flex h-[57px] shrink-0 items-center gap-2 px-3">
      <img :src="logo" alt="" class="h-6 w-6" />
      <h1 class="truncate text-sm font-semibold">代码管理</h1>
    </header>

    <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <ul class="space-y-px">
        <li>
          <button
            class="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left"
            :class="rowClass(SCOPE_ALL)"
            :aria-current="store.scope === SCOPE_ALL ? 'true' : undefined"
            @click="store.scope = SCOPE_ALL"
          >
            <Layers :size="14" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">全部项目</span>
            <span class="text-xs tabular-nums opacity-60">{{ store.projects.length }}</span>
          </button>
        </li>
        <li>
          <button
            class="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left"
            :class="rowClass(SCOPE_UNCATEGORIZED)"
            :aria-current="store.scope === SCOPE_UNCATEGORIZED ? 'true' : undefined"
            @click="store.scope = SCOPE_UNCATEGORIZED"
            @dragover="onDragOver($event, SCOPE_UNCATEGORIZED)"
            @dragleave="dropTarget = null"
            @drop="onDrop($event, null)"
          >
            <Inbox :size="14" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">未分类</span>
            <span class="text-xs tabular-nums opacity-60">{{ store.uncategorizedCount }}</span>
          </button>
        </li>
        <li>
          <button
            class="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left"
            :class="rowClass(SCOPE_HIDDEN)"
            :aria-current="store.scope === SCOPE_HIDDEN ? 'true' : undefined"
            @click="store.scope = SCOPE_HIDDEN"
          >
            <EyeOff :size="14" class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">已隐藏</span>
            <span class="text-xs tabular-nums opacity-60" data-testid="hidden-count">{{ store.hiddenProjects.length }}</span>
          </button>
        </li>
      </ul>

      <div class="mt-3 flex h-7 items-center justify-between pl-2">
        <h2 class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">分类</h2>
        <button
          class="icon-btn"
          title="新建分类"
          aria-label="新建分类"
          @click="startEditing({ mode: 'create', parentId: null })"
        >
          <FolderPlus :size="14" />
        </button>
      </div>

      <ul class="space-y-px" data-testid="category-tree">
        <template v-for="row in rows" :key="row.category.id">
          <li
            class="group relative flex h-7 items-center rounded-md"
            :class="[
              isRenaming(row.category.id) ? '' : rowClass(row.category.id),
              draggingSubtree.has(row.category.id) ? 'opacity-50' : ''
            ]"
            :style="{ paddingLeft: `${row.depth * INDENT_PX}px` }"
            :draggable="!isRenaming(row.category.id)"
            data-testid="category-row"
            @dragstart="onCategoryDragStart($event, row.category.id)"
            @dragend="clearCategoryDrag"
            @dragover="onRowDragOver($event, row.category.id)"
            @dragleave="onRowDragLeave"
            @drop="onRowDrop($event, row.category.id)"
          >
            <span
              v-if="insertLine?.id === row.category.id"
              class="pointer-events-none absolute right-0 h-0.5 rounded bg-teal-500"
              :class="insertLine.position === 'before' ? '-top-px' : '-bottom-px'"
              :style="{ left: `${insertLineLeft(row)}px` }"
              data-testid="category-insert-line"
            />
            <button
              v-if="row.hasChildren"
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-70 hover:opacity-100"
              :title="store.collapsed.has(row.category.id) ? '展开' : '折叠'"
              :aria-label="store.collapsed.has(row.category.id) ? `展开 ${row.category.name}` : `折叠 ${row.category.name}`"
              :aria-expanded="!store.collapsed.has(row.category.id)"
              @click="store.toggleCollapsed(row.category.id)"
            >
              <ChevronRight v-if="store.collapsed.has(row.category.id)" :size="13" />
              <ChevronDown v-else :size="13" />
            </button>
            <span v-else class="w-5 shrink-0" />

            <input
              v-if="isRenaming(row.category.id)"
              ref="input"
              v-model="draft"
              maxlength="40"
              aria-label="分类名称"
              class="field h-6 min-w-0 flex-1 px-1.5 text-xs"
              @keydown.enter.prevent="commitEditing"
              @keydown.esc="cancelEditing"
              @blur="commitEditing"
            />
            <template v-else>
              <button
                class="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1 text-left"
                :title="row.category.name"
                :aria-current="store.scope === row.category.id ? 'true' : undefined"
                @click="store.scope = row.category.id"
              >
                <Folder :size="14" class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{{ row.category.name }}</span>
                <span class="pr-1 text-xs tabular-nums opacity-60 group-focus-within:hidden group-hover:hidden">
                  {{ store.categoryCounts.get(row.category.id) ?? 0 }}
                </span>
              </button>
              <span class="hidden shrink-0 group-focus-within:flex group-hover:flex">
                <button
                  class="flex h-6 w-6 items-center justify-center rounded opacity-70 hover:bg-zinc-300/60 hover:opacity-100 dark:hover:bg-zinc-600"
                  :title="`在“${row.category.name}”下新建子分类`"
                  aria-label="新建子分类"
                  @click="startEditing({ mode: 'create', parentId: row.category.id })"
                >
                  <FolderPlus :size="13" />
                </button>
                <button
                  class="flex h-6 w-6 items-center justify-center rounded opacity-70 hover:bg-zinc-300/60 hover:opacity-100 dark:hover:bg-zinc-600"
                  title="重命名"
                  aria-label="重命名分类"
                  @click="startEditing({ mode: 'rename', id: row.category.id }, row.category.name)"
                >
                  <Pencil :size="12" />
                </button>
                <button
                  class="flex h-6 w-6 items-center justify-center rounded opacity-70 hover:bg-zinc-300/60 hover:opacity-100 dark:hover:bg-zinc-600"
                  title="删除分类（不会删除项目）"
                  aria-label="删除分类"
                  @click="store.deleteCategory(row.category.id)"
                >
                  <Trash2 :size="12" />
                </button>
              </span>
            </template>
          </li>

          <li
            v-if="isCreatingUnder(row.category.id)"
            class="flex h-7 items-center"
            :style="{ paddingLeft: `${(row.depth + 1) * INDENT_PX + BASE_PADDING_PX}px` }"
          >
            <input
              ref="input"
              v-model="draft"
              maxlength="40"
              placeholder="子分类名称，回车确认"
              aria-label="分类名称"
              class="field h-6 min-w-0 flex-1 px-1.5 text-xs"
              @keydown.enter.prevent="commitEditing"
              @keydown.esc="cancelEditing"
              @blur="commitEditing"
            />
          </li>
        </template>

        <li v-if="isCreatingUnder(null)" class="flex h-7 items-center px-1">
          <input
            ref="input"
            v-model="draft"
            maxlength="40"
            placeholder="分类名称，回车确认"
            aria-label="分类名称"
            class="field h-6 min-w-0 flex-1 px-1.5 text-xs"
            @keydown.enter.prevent="commitEditing"
            @keydown.esc="cancelEditing"
            @blur="commitEditing"
          />
        </li>

        <li
          v-if="draggingId"
          class="mt-1 flex h-7 items-center justify-center rounded-md border border-dashed text-xs"
          :class="
            overRootEnd
              ? 'border-teal-500 text-teal-700 dark:text-teal-300'
              : 'border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400'
          "
          data-testid="category-root-drop"
          @dragover="onRootEndDragOver"
          @dragleave="overRootEnd = false"
          @drop="onRootEndDrop"
        >
          移到顶层
        </li>
      </ul>

      <p v-if="!rows.length && !editing" class="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
        新建分类后，把项目卡片拖进来，或在卡片上选择分类。
      </p>
    </nav>

    <footer class="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-700/70">
      <div
        role="radiogroup"
        aria-label="外观"
        class="flex rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-900/60"
      >
        <button
          v-for="theme in THEMES"
          :key="theme.value"
          role="radio"
          :aria-checked="store.config.theme === theme.value"
          :title="theme.title"
          class="flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-xs transition-colors"
          :class="
            store.config.theme === theme.value
              ? 'bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
          "
          @click="store.setTheme(theme.value)"
        >
          <component :is="theme.icon" :size="13" />
          {{ theme.label }}
        </button>
      </div>
    </footer>
  </aside>
</template>
