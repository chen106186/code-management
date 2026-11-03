<script setup lang="ts">
import { computed } from 'vue'
import type { ChangedFile } from '@shared/repo'
import DiffViewer from '@renderer/components/repo/DiffViewer.vue'
import FileRow from '@renderer/components/repo/FileRow.vue'
import { useRepoStore } from '@renderer/stores/repo'

const repo = useRepoStore()

type Kind = 'staged' | 'unstaged'

const sections = computed<{ title: string; kind: Kind; files: ChangedFile[]; alert?: boolean }[]>(() => {
  const changes = repo.changes
  if (!changes) return []
  const all = [
    { title: '冲突', kind: 'unstaged' as const, files: changes.conflicted, alert: true },
    { title: '已暂存', kind: 'staged' as const, files: changes.staged },
    { title: '未暂存', kind: 'unstaged' as const, files: changes.unstaged }
  ]
  return all.filter((section) => section.files.length)
})

const isSelected = (kind: Kind, file: ChangedFile): boolean =>
  repo.changeTarget?.kind === kind && repo.changeTarget.path === file.path
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside class="w-80 shrink-0 overflow-y-auto border-r border-zinc-200 pb-2 dark:border-zinc-700/70">
      <p v-if="!sections.length" class="p-4 text-center text-zinc-500">工作区干净，没有改动</p>
      <section v-for="section in sections" :key="section.title" :aria-label="section.title">
        <h3
          class="flex h-8 items-center px-3 text-xs font-semibold"
          :class="section.alert ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300'"
        >
          {{ section.title }} {{ section.files.length }}
        </h3>
        <ul>
          <FileRow
            v-for="file in section.files"
            :key="file.path"
            :file="file"
            :selected="isSelected(section.kind, file)"
            @select="repo.selectChange(section.kind, file)"
          />
        </ul>
      </section>
    </aside>

    <DiffViewer
      v-if="repo.path"
      class="flex-1"
      :repo="repo.path"
      :target="repo.changeTarget"
      :version="repo.changeVersion"
    />
  </div>
</template>
