<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCheck, EyeOff, Folder, Star, Tag, X } from 'lucide-vue-next'
import { flattenCategories } from '@shared/categories'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

const categoryOptions = computed(() => flattenCategories(store.categories))
const tagDraft = ref('')
const allSelected = computed(() => store.selectedPaths.length === store.visible.length)
const allFavorite = computed(() =>
  store.visible.filter((p) => store.selected.has(p.path)).every((p) => p.favorite)
)

function onCategoryChange(event: Event): void {
  const select = event.target as HTMLSelectElement
  if (select.value === '') return
  void store.updateProjects(store.selectedPaths, {
    categoryId: select.value === 'none' ? null : select.value
  })
  select.value = ''
}

function addTag(): void {
  const tag = tagDraft.value.trim()
  tagDraft.value = ''
  if (tag) void store.updateProjects(store.selectedPaths, { addTag: tag })
}
</script>

<template>
  <div
    role="toolbar"
    aria-label="批量操作"
    data-testid="batch-bar"
    class="flex shrink-0 flex-wrap items-center gap-2 border-b border-teal-200 bg-teal-50 px-4 py-2 dark:border-teal-900 dark:bg-teal-950/40"
  >
    <span class="font-medium tabular-nums" data-testid="batch-count">已选 {{ store.selectedPaths.length }} 个</span>
    <button class="btn h-7 text-xs" :disabled="allSelected" @click="store.selectAllVisible()">
      <CheckCheck :size="13" /> 全选当前 {{ store.visible.length }} 个
    </button>

    <span class="mx-1 h-4 w-px bg-teal-200 dark:bg-teal-800" />

    <label v-if="categoryOptions.length" class="relative flex items-center">
      <Folder :size="12" class="pointer-events-none absolute left-2 text-zinc-500" />
      <select class="field h-7 pl-6 text-xs" aria-label="移到分类" data-testid="batch-category" value="" @change="onCategoryChange">
        <option value="" disabled>移到分类…</option>
        <option value="none">未分类</option>
        <option v-for="{ category, depth } in categoryOptions" :key="category.id" :value="category.id">
          {{ '　'.repeat(depth) }}{{ category.name }}
        </option>
      </select>
    </label>

    <label class="relative flex items-center">
      <Tag :size="12" class="pointer-events-none absolute left-2 text-zinc-500" />
      <input
        v-model="tagDraft"
        maxlength="20"
        placeholder="加标签，回车确认"
        aria-label="批量添加标签"
        data-testid="batch-tag"
        class="field h-7 w-36 pl-6 text-xs"
        @keydown.enter.prevent="addTag"
      />
    </label>

    <button
      class="btn h-7 text-xs"
      data-testid="batch-favorite"
      @click="store.updateProjects(store.selectedPaths, { favorite: !allFavorite })"
    >
      <Star :size="13" /> {{ allFavorite ? '取消收藏' : '收藏' }}
    </button>
    <button class="btn h-7 text-xs" data-testid="batch-hide" @click="store.hideProjects(store.selectedPaths)">
      <EyeOff :size="13" /> 隐藏
    </button>

    <button class="icon-btn ml-auto" title="取消选择（Esc）" aria-label="取消选择" @click="store.clearSelection()">
      <X :size="15" />
    </button>
  </div>
</template>
