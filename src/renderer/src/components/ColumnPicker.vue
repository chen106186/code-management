<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Columns3 } from 'lucide-vue-next'
import { LIST_COLUMNS } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onOutsidePointer(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

function close(): void {
  open.value = false
  document.removeEventListener('pointerdown', onOutsidePointer)
  document.removeEventListener('keydown', onKey)
}

function toggle(): void {
  if (open.value) return close()
  open.value = true
  document.addEventListener('pointerdown', onOutsidePointer)
  document.addEventListener('keydown', onKey)
}

onBeforeUnmount(close)
</script>

<template>
  <div ref="root" class="relative">
    <button
      class="icon-btn"
      title="选择显示的列"
      aria-label="选择显示的列"
      aria-haspopup="true"
      :aria-expanded="open"
      data-testid="column-picker"
      @click="toggle"
    >
      <Columns3 :size="15" />
    </button>
    <ul
      v-if="open"
      class="absolute right-0 top-full z-30 mt-1 w-36 rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
      data-testid="column-menu"
    >
      <li v-for="column in LIST_COLUMNS" :key="column.id">
        <label class="flex h-7 cursor-pointer items-center gap-2 rounded px-2 hover:bg-zinc-100 dark:hover:bg-zinc-700">
          <input
            type="checkbox"
            class="accent-teal-600"
            :checked="!store.hiddenColumns.includes(column.id)"
            :data-testid="`column-${column.id}`"
            @change="store.toggleColumn(column.id)"
          />
          {{ column.label }}
        </label>
      </li>
    </ul>
  </div>
</template>
