<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-vue-next'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

const saving = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

async function start(): Promise<void> {
  saving.value = true
  draft.value = ''
  await nextTick()
  input.value?.focus()
}

function commit(): void {
  const name = draft.value.trim()
  saving.value = false
  if (name) void store.saveCurrentView(name)
}
</script>

<template>
  <div class="mt-3 flex h-7 items-center justify-between pl-2">
    <h2 class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">视图</h2>
    <button
      class="icon-btn"
      title="把当前的筛选、搜索和排序保存为视图"
      aria-label="保存当前视图"
      data-testid="save-view"
      @click="start"
    >
      <BookmarkPlus :size="14" />
    </button>
  </div>

  <ul class="space-y-px" data-testid="saved-views">
    <li
      v-for="view in store.savedViews"
      :key="view.id"
      class="group flex h-7 items-center rounded-md"
      :class="
        store.activeViewId === view.id
          ? 'bg-teal-100/70 font-medium text-teal-900 dark:bg-teal-900/40 dark:text-teal-200'
          : 'text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-700/50'
      "
      data-testid="saved-view"
    >
      <button
        class="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left"
        :title="view.name"
        :aria-current="store.activeViewId === view.id ? 'true' : undefined"
        @click="store.applyView(view)"
      >
        <Bookmark :size="14" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ view.name }}</span>
      </button>
      <button
        class="hidden h-6 w-6 shrink-0 items-center justify-center rounded opacity-70 hover:bg-zinc-300/60 hover:opacity-100 group-focus-within:flex group-hover:flex dark:hover:bg-zinc-600"
        title="删除视图（不影响项目）"
        :aria-label="`删除视图 ${view.name}`"
        @click="store.deleteView(view.id)"
      >
        <Trash2 :size="12" />
      </button>
    </li>
    <li v-if="saving" class="flex h-7 items-center px-1">
      <input
        ref="input"
        v-model="draft"
        maxlength="30"
        placeholder="视图名称，回车确认"
        aria-label="视图名称"
        class="field h-6 min-w-0 flex-1 px-1.5 text-xs"
        @keydown.enter.prevent="commit"
        @keydown.esc.stop="saving = false"
        @blur="commit"
      />
    </li>
  </ul>
  <p v-if="!store.savedViews.length && !saving" class="px-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
    设好筛选后点上方按钮保存，下次一键切换。
  </p>
</template>
