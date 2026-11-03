<script setup lang="ts">
import { computed } from 'vue'
import { formatRelative } from '@renderer/lib/projectList'
import { useRepoStore } from '@renderer/stores/repo'

const repo = useRepoStore()

const local = computed(() => repo.branches.filter((b) => b.kind === 'local'))
const trackedUpstreams = computed(() => new Set(local.value.map((b) => b.upstream)))
const remote = computed(() =>
  repo.branches.filter((b) => b.kind === 'remote' && !trackedUpstreams.value.has(b.name))
)
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <div class="mx-auto max-w-4xl space-y-5">
      <section class="space-y-1">
        <h3 class="text-xs font-semibold text-zinc-600 dark:text-zinc-300">本地分支 {{ local.length }}</h3>
        <ul class="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-700/70 dark:border-zinc-700/70 dark:bg-zinc-800/60">
          <li v-for="branch in local" :key="branch.name" class="px-3 py-1.5" data-testid="branch-row">
            <p class="flex items-center gap-2">
              <span class="truncate font-medium" :title="branch.name">{{ branch.name }}</span>
              <span
                v-if="branch.current"
                class="shrink-0 rounded bg-teal-50 px-1.5 text-[11px] text-teal-800 dark:bg-teal-900/40 dark:text-teal-300"
              >
                当前
              </span>
              <span v-if="branch.upstream" class="min-w-0 truncate text-xs text-zinc-400">{{ branch.upstream }}</span>
              <span v-if="branch.ahead" class="shrink-0 text-xs text-teal-700 dark:text-teal-400">↑{{ branch.ahead }}</span>
              <span v-if="branch.behind" class="shrink-0 text-xs text-amber-700 dark:text-amber-400">↓{{ branch.behind }}</span>
              <span v-if="branch.gone" class="shrink-0 text-xs text-zinc-400">上游已删除</span>
            </p>
            <p class="truncate text-xs text-zinc-500 dark:text-zinc-400" :title="branch.subject">
              {{ branch.subject }} · {{ formatRelative(branch.time) }}
            </p>
          </li>
          <li v-if="!local.length" class="px-3 py-3 text-zinc-500">提交之后才会有分支</li>
        </ul>
      </section>

      <section v-if="remote.length" class="space-y-1">
        <h3 class="text-xs font-semibold text-zinc-600 dark:text-zinc-300">远程分支 {{ remote.length }}</h3>
        <ul class="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white dark:divide-zinc-700/70 dark:border-zinc-700/70 dark:bg-zinc-800/60">
          <li v-for="branch in remote" :key="branch.name" class="px-3 py-1.5" data-testid="remote-branch-row">
            <p class="truncate font-medium" :title="branch.name">{{ branch.name }}</p>
            <p class="truncate text-xs text-zinc-500 dark:text-zinc-400" :title="branch.subject">
              {{ branch.subject }} · {{ formatRelative(branch.time) }}
            </p>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
