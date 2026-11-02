<script setup lang="ts">
import DiffViewer from '@renderer/components/repo/DiffViewer.vue'
import FileRow from '@renderer/components/repo/FileRow.vue'
import { formatRelative } from '@renderer/lib/projectList'
import { useRepoStore } from '@renderer/stores/repo'

const repo = useRepoStore()

const NEAR_BOTTOM_PX = 200

function onScroll(event: Event): void {
  const list = event.target as HTMLElement
  if (list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX) {
    void repo.loadMoreCommits()
  }
}

const refLabel = (ref: string): string => ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <aside
      class="w-80 shrink-0 overflow-y-auto border-r border-zinc-200 dark:border-zinc-700/70"
      data-testid="commit-list"
      @scroll.passive="onScroll"
    >
      <p v-if="!repo.commits.length && !repo.loadingCommits" class="p-4 text-center text-zinc-500">
        还没有提交
      </p>
      <ul>
        <li v-for="commit in repo.commits" :key="commit.hash" class="commit-row">
          <button
            class="block w-full px-3 py-1.5 text-left"
            :class="
              repo.commitDetail?.hash === commit.hash
                ? 'bg-teal-50 dark:bg-teal-900/30'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-700/40'
            "
            data-testid="commit-row"
            @click="repo.selectCommit(commit.hash)"
          >
            <span class="block truncate" :title="commit.subject">{{ commit.subject }}</span>
            <span class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <span class="font-mono">{{ commit.hash.slice(0, 7) }}</span>
              <span class="min-w-0 truncate">{{ commit.author }}</span>
              <span class="ml-auto shrink-0">{{ formatRelative(commit.time) }}</span>
            </span>
            <span v-if="commit.refs.length" class="mt-0.5 flex flex-wrap gap-1">
              <span
                v-for="ref in commit.refs"
                :key="ref"
                class="max-w-full truncate rounded bg-zinc-100 px-1 text-[11px] text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300"
              >
                {{ refLabel(ref) }}
              </span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="repo.loadingCommits" class="p-3 text-center text-xs text-zinc-500">正在加载…</p>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <p v-if="!repo.commitDetail" class="py-16 text-center text-zinc-500">选择提交查看详情</p>
      <template v-else>
        <section
          class="max-h-[40%] shrink-0 overflow-y-auto border-b border-zinc-200 dark:border-zinc-700/70"
          data-testid="commit-detail"
        >
          <div class="space-y-1 p-3">
            <pre class="whitespace-pre-wrap break-words font-sans font-medium">{{ repo.commitDetail.message }}</pre>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              <span class="font-mono">{{ repo.commitDetail.hash.slice(0, 12) }}</span>
              · {{ repo.commitDetail.author }} &lt;{{ repo.commitDetail.email }}&gt; ·
              {{ new Date(repo.commitDetail.time).toLocaleString('zh-CN') }}
            </p>
            <p v-if="repo.commitDetail.parents.length > 1" class="text-xs text-zinc-500 dark:text-zinc-400">
              合并提交，以下是与第一个父提交的差异
            </p>
          </div>
          <ul class="pb-1">
            <FileRow
              v-for="file in repo.commitDetail.files"
              :key="file.path"
              :file="file"
              :selected="repo.commitTarget?.path === file.path"
              @select="repo.selectCommitFile(file)"
            />
          </ul>
        </section>
        <DiffViewer
          v-if="repo.path"
          class="min-h-0 flex-1"
          :repo="repo.path"
          :target="repo.commitTarget"
        />
      </template>
    </div>
  </div>
</template>
