<script setup lang="ts">
import { EyeOff, RotateCcw } from 'lucide-vue-next'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()
</script>

<template>
  <section aria-label="已隐藏的项目" class="mx-auto max-w-4xl space-y-3">
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      这些项目不会显示在列表里，文件没有任何变化。恢复后会回到原来的分类。
    </p>

    <div
      v-if="!store.hiddenProjects.length"
      class="flex flex-col items-center gap-2 py-16 text-center text-zinc-500 dark:text-zinc-400"
    >
      <EyeOff :size="24" class="text-zinc-400" />
      <p>没有隐藏的项目</p>
    </div>

    <p v-else-if="!store.visibleHidden.length" class="py-16 text-center text-zinc-500">
      没有符合条件的项目
    </p>

    <ul
      v-else
      class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-700/70 dark:border-zinc-700/70 dark:bg-zinc-800/60"
    >
      <li
        v-for="project in store.visibleHidden"
        :key="project.path"
        class="flex items-center gap-3 px-4 py-2.5"
        data-testid="hidden-project"
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-400 dark:bg-zinc-700/60"
        >
          <EyeOff :size="15" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="flex min-w-0 items-baseline gap-2 leading-5">
            <span class="min-w-0 truncate font-semibold" :title="project.remark ?? project.name">
              {{ project.remark ?? project.name }}
            </span>
            <span v-if="project.remark" class="min-w-0 truncate text-xs text-zinc-400">{{ project.name }}</span>
          </p>
          <p class="truncate text-xs leading-4 text-zinc-500 dark:text-zinc-400" :title="project.path">
            {{ project.path }}
          </p>
        </div>
        <button class="btn h-7 text-xs" @click="store.restoreProject(project.path)">
          <RotateCcw :size="13" /> 恢复显示
        </button>
      </li>
    </ul>
  </section>
</template>
