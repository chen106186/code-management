<script setup lang="ts">
import { computed } from 'vue'
import { Minus, Plus } from 'lucide-vue-next'
import type { ChangedFile } from '@shared/repo'
import DiffViewer from '@renderer/components/repo/DiffViewer.vue'
import FileRow from '@renderer/components/repo/FileRow.vue'
import { useRepoStore } from '@renderer/stores/repo'

const repo = useRepoStore()

const staged = computed(() => repo.changes?.staged ?? [])
const unstaged = computed(() => repo.changes?.unstaged ?? [])
const conflicted = computed(() => repo.changes?.conflicted ?? [])
const branch = computed(() => repo.changes?.status.branch)

const canCommit = computed(
  () =>
    staged.value.length > 0 &&
    conflicted.value.length === 0 &&
    repo.commitMessage.trim().length > 0 &&
    !repo.committing
)

const isSelected = (kind: 'staged' | 'unstaged', file: ChangedFile): boolean =>
  repo.changeTarget?.kind === kind && repo.changeTarget.path === file.path

function commit(): void {
  if (canCommit.value) void repo.commit()
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside class="flex w-80 shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-700/70">
      <div class="min-h-0 flex-1 overflow-y-auto pb-2">
        <section v-if="conflicted.length" aria-label="冲突文件">
          <h3 class="flex h-8 items-center px-3 text-xs font-semibold text-red-600 dark:text-red-400">
            冲突 {{ conflicted.length }}
          </h3>
          <p class="px-3 pb-1 text-xs text-zinc-500 dark:text-zinc-400">
            在编辑器中解决冲突后，点 + 标记为已解决。
          </p>
          <ul>
            <FileRow
              v-for="file in conflicted"
              :key="file.path"
              :file="file"
              :selected="isSelected('unstaged', file)"
              @select="repo.selectChange('unstaged', file)"
            >
              <button class="icon-btn" title="标记为已解决" aria-label="标记为已解决" @click="repo.stage([file])">
                <Plus :size="14" />
              </button>
            </FileRow>
          </ul>
        </section>

        <section aria-label="已暂存">
          <h3 class="flex h-8 items-center justify-between pl-3 pr-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            已暂存 {{ staged.length }}
            <button
              v-if="staged.length"
              class="rounded px-1.5 py-0.5 font-normal hover:bg-zinc-200/70 dark:hover:bg-zinc-700"
              @click="repo.unstage(staged)"
            >
              全部取消
            </button>
          </h3>
          <ul>
            <FileRow
              v-for="file in staged"
              :key="file.path"
              :file="file"
              :selected="isSelected('staged', file)"
              @select="repo.selectChange('staged', file)"
            >
              <button class="icon-btn" title="取消暂存" aria-label="取消暂存" @click="repo.unstage([file])">
                <Minus :size="14" />
              </button>
            </FileRow>
          </ul>
        </section>

        <section aria-label="未暂存">
          <h3 class="flex h-8 items-center justify-between pl-3 pr-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
            未暂存 {{ unstaged.length }}
            <button
              v-if="unstaged.length"
              class="rounded px-1.5 py-0.5 font-normal hover:bg-zinc-200/70 dark:hover:bg-zinc-700"
              @click="repo.stage(unstaged)"
            >
              全部暂存
            </button>
          </h3>
          <ul>
            <FileRow
              v-for="file in unstaged"
              :key="file.path"
              :file="file"
              :selected="isSelected('unstaged', file)"
              @select="repo.selectChange('unstaged', file)"
            >
              <button class="icon-btn" title="暂存" aria-label="暂存" @click="repo.stage([file])">
                <Plus :size="14" />
              </button>
            </FileRow>
          </ul>
        </section>
      </div>

      <form
        class="flex shrink-0 flex-col gap-2 border-t border-zinc-200 p-3 dark:border-zinc-700/70"
        @submit.prevent="commit"
      >
        <textarea
          v-model="repo.commitMessage"
          rows="3"
          placeholder="提交信息（Ctrl+Enter 提交）"
          aria-label="提交信息"
          class="field h-auto resize-none py-1.5"
          @keydown.ctrl.enter.prevent="commit"
        />
        <button type="submit" class="btn btn-primary justify-center" :disabled="!canCommit">
          {{ repo.committing ? '正在提交…' : `提交到 ${branch ?? 'HEAD'}` }}
        </button>
      </form>
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
