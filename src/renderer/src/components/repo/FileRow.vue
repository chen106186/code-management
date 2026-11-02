<script setup lang="ts">
import { computed } from 'vue'
import type { ChangedFile, FileState } from '@shared/repo'

const props = defineProps<{ file: ChangedFile; selected: boolean }>()
defineEmits<{ select: [] }>()

const BADGES: Record<FileState, { letter: string; label: string; tone: string }> = {
  added: { letter: 'A', label: '新增', tone: 'text-teal-700 dark:text-teal-400' },
  modified: { letter: 'M', label: '修改', tone: 'text-amber-700 dark:text-amber-400' },
  deleted: { letter: 'D', label: '删除', tone: 'text-red-600 dark:text-red-400' },
  renamed: { letter: 'R', label: '重命名', tone: 'text-sky-700 dark:text-sky-400' },
  copied: { letter: 'C', label: '复制', tone: 'text-sky-700 dark:text-sky-400' },
  typechange: { letter: 'T', label: '类型变更', tone: 'text-amber-700 dark:text-amber-400' },
  untracked: { letter: 'U', label: '未跟踪', tone: 'text-zinc-500 dark:text-zinc-400' },
  conflicted: { letter: '!', label: '冲突', tone: 'text-red-600 dark:text-red-400' }
}

const badge = computed(() => BADGES[props.file.state])
const name = computed(() => props.file.path.split('/').pop() ?? props.file.path)
const dir = computed(() => props.file.path.split('/').slice(0, -1).join('/'))
const title = computed(() =>
  props.file.origPath ? `${props.file.origPath} → ${props.file.path}` : props.file.path
)
</script>

<template>
  <li
    class="file-row group flex h-7 items-center gap-1 pl-3 pr-1"
    :class="selected ? 'bg-teal-50 dark:bg-teal-900/30' : 'hover:bg-zinc-100 dark:hover:bg-zinc-700/40'"
    data-testid="file-row"
  >
    <button class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left" :title="title" @click="$emit('select')">
      <span class="w-3 shrink-0 text-center font-mono text-xs font-semibold" :class="badge.tone" :title="badge.label">
        {{ badge.letter }}
      </span>
      <span class="shrink-0 truncate" style="max-width: 70%">{{ name }}</span>
      <span class="min-w-0 truncate text-xs text-zinc-400">{{ dir }}</span>
    </button>
    <slot />
  </li>
</template>
