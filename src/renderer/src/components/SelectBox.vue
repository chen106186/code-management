<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import { useProjectsStore } from '@renderer/stores/projects'

const props = defineProps<{ path: string; label: string }>()
const store = useProjectsStore()

const checked = computed(() => store.selected.has(props.path))
</script>

<template>
  <button
    role="checkbox"
    :aria-checked="checked"
    :aria-label="`选择 ${label}`"
    title="选择（按住 Shift 连选）"
    data-testid="project-select"
    class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-opacity"
    :class="
      checked
        ? 'border-teal-600 bg-teal-600 text-white'
        : [
            'border-zinc-400 bg-white dark:border-zinc-500 dark:bg-zinc-800',
            store.selectedPaths.length ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/card:opacity-100'
          ]
    "
    @click="store.toggleSelected(path, $event.shiftKey)"
  >
    <Check v-if="checked" :size="12" :stroke-width="3" />
  </button>
</template>
