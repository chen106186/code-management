<script setup lang="ts">
import { STAT_FILTERS, type FilterKind } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

const TONES: Partial<Record<FilterKind, string>> = {
  changed: 'text-amber-600 dark:text-amber-400',
  unpushed: 'text-teal-700 dark:text-teal-400',
  behind: 'text-sky-700 dark:text-sky-400',
  stale: 'text-zinc-600 dark:text-zinc-300'
}

/** 再点一次已选中的统计项就回到全部 */
function toggle(kind: FilterKind): void {
  store.filter = store.filter === kind ? 'all' : kind
}
</script>

<template>
  <div class="grid grid-cols-4 gap-2" data-testid="board-stats">
    <button
      v-for="{ kind, label, hint } in STAT_FILTERS"
      :key="kind"
      :title="hint"
      :aria-pressed="store.filter === kind"
      :data-testid="`stat-${kind}`"
      class="flex items-baseline justify-between gap-2 rounded-lg border px-3 py-1.5 text-left transition-colors"
      :class="
        store.filter === kind
          ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30'
          : 'border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700/70 dark:hover:bg-zinc-700/50'
      "
      @click="toggle(kind)"
    >
      <span class="truncate text-xs text-zinc-500 dark:text-zinc-400">{{ label }}</span>
      <span
        class="text-lg font-semibold tabular-nums leading-6"
        :class="store.filterCounts[kind] ? TONES[kind] : 'text-zinc-300 dark:text-zinc-600'"
      >
        {{ store.filterCounts[kind] }}
      </span>
    </button>
  </div>
</template>
