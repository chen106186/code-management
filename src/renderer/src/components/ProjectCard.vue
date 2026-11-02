<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Code2,
  EyeOff,
  FolderOpen,
  GitBranch,
  Plus,
  Star,
  Terminal,
  X
} from 'lucide-vue-next'
import type { Project } from '@shared/types'
import { changeCount, formatRelative } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const props = defineProps<{ project: Project }>()
const store = useProjectsStore()

const git = computed(() => props.project.git)
const changes = computed(() => changeCount(git.value))
const branchLabel = computed(() => {
  if (!git.value) return ''
  return git.value.branch ?? `游离 ${git.value.head?.slice(0, 7) ?? ''}`
})
const changeParts = computed(() => {
  const g = git.value
  if (!g) return []
  return [
    { label: '冲突', count: g.conflicted, tone: 'text-red-600 dark:text-red-400' },
    { label: '已暂存', count: g.staged, tone: 'text-teal-700 dark:text-teal-400' },
    { label: '未暂存', count: g.unstaged, tone: 'text-amber-700 dark:text-amber-400' },
    { label: '未跟踪', count: g.untracked, tone: 'text-zinc-500 dark:text-zinc-400' }
  ].filter((part) => part.count > 0)
})

const editingTag = ref(false)
const tagDraft = ref('')
const tagInput = ref<HTMLInputElement | null>(null)

async function startTag(): Promise<void> {
  editingTag.value = true
  await nextTick()
  tagInput.value?.focus()
}

function commitTag(): void {
  const tag = tagDraft.value.trim()
  tagDraft.value = ''
  editingTag.value = false
  if (tag) void store.setTags(props.project.path, [...props.project.tags, tag])
}

function cancelTag(): void {
  tagDraft.value = ''
  editingTag.value = false
}

function removeTag(tag: string): void {
  void store.setTags(
    props.project.path,
    props.project.tags.filter((t) => t !== tag)
  )
}
</script>

<template>
  <article
    data-testid="project-card"
    class="flex min-w-0 flex-col gap-2.5 rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-700/70 dark:bg-zinc-800/60"
  >
    <header class="flex items-start gap-1">
      <button
        class="icon-btn -ml-1"
        :title="project.favorite ? '取消收藏' : '收藏'"
        :aria-label="project.favorite ? '取消收藏' : '收藏'"
        :aria-pressed="project.favorite"
        @click="store.toggleFavorite(project.path)"
      >
        <Star :size="15" :class="project.favorite ? 'fill-amber-400 text-amber-400' : ''" />
      </button>
      <div class="min-w-0 flex-1 pt-0.5">
        <h2 class="truncate text-sm font-semibold" :title="project.name">{{ project.name }}</h2>
        <p class="truncate text-xs text-zinc-500 dark:text-zinc-400" :title="project.path">
          {{ project.path }}
        </p>
      </div>
      <div class="-mr-1 flex">
        <template v-if="!project.missing">
          <button
            class="icon-btn"
            title="用 VS Code 打开"
            aria-label="用 VS Code 打开"
            @click="store.openInEditor(project.path)"
          >
            <Code2 :size="15" />
          </button>
          <button
            class="icon-btn"
            title="在终端打开"
            aria-label="在终端打开"
            @click="store.openInTerminal(project.path)"
          >
            <Terminal :size="15" />
          </button>
          <button
            class="icon-btn"
            title="在资源管理器打开"
            aria-label="在资源管理器打开"
            @click="store.openInExplorer(project.path)"
          >
            <FolderOpen :size="15" />
          </button>
        </template>
        <button
          class="icon-btn"
          title="从列表隐藏（不会删除文件）"
          aria-label="从列表隐藏"
          @click="store.hideProject(project.path)"
        >
          <EyeOff :size="15" />
        </button>
      </div>
    </header>

    <div class="min-h-[2.75rem] space-y-1">
      <p v-if="project.missing" class="flex items-center gap-1.5 text-red-600 dark:text-red-400">
        <CircleAlert :size="14" class="shrink-0" /> 路径不存在
      </p>

      <p
        v-else-if="project.gitError"
        class="line-clamp-2 break-all text-xs text-red-600 dark:text-red-400"
        :title="project.gitError"
      >
        {{ project.gitError }}
      </p>

      <template v-else-if="git">
        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span class="flex min-w-0 items-center gap-1 font-medium">
            <GitBranch :size="13" class="shrink-0 text-zinc-400" />
            <span class="max-w-[12rem] truncate" :title="branchLabel">{{ branchLabel }}</span>
          </span>
          <span
            v-if="git.ahead"
            class="flex items-center text-xs text-teal-700 dark:text-teal-400"
            :title="`领先上游 ${git.ahead} 个提交`"
          >
            <ArrowUp :size="12" />{{ git.ahead }}
          </span>
          <span
            v-if="git.behind"
            class="flex items-center text-xs text-amber-700 dark:text-amber-400"
            :title="`落后上游 ${git.behind} 个提交`"
          >
            <ArrowDown :size="12" />{{ git.behind }}
          </span>
          <span v-if="git.head && !git.upstream" class="text-xs text-zinc-400">无上游</span>
          <span v-if="!changes" class="text-xs text-zinc-400">工作区干净</span>
          <span
            v-for="part in changeParts"
            :key="part.label"
            class="text-xs tabular-nums"
            :class="part.tone"
          >
            {{ part.count }} {{ part.label }}
          </span>
        </div>
        <p v-if="git.lastCommit" class="flex gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span class="min-w-0 truncate" :title="git.lastCommit.subject">
            {{ git.lastCommit.subject }}
          </span>
          <span class="ml-auto shrink-0">{{ formatRelative(git.lastCommit.time) }}</span>
        </p>
        <p v-else class="text-xs text-zinc-400">尚无提交</p>
      </template>

      <template v-else>
        <div class="flex items-center justify-between gap-2">
          <span class="text-zinc-500 dark:text-zinc-400">未使用 Git</span>
          <button class="btn h-7 text-xs" @click="store.initGit(project.path)">初始化仓库</button>
        </div>
        <p v-if="project.lastActivity" class="text-xs text-zinc-400">
          文件修改于 {{ formatRelative(project.lastActivity) }}
        </p>
      </template>
    </div>

    <footer class="mt-auto flex flex-wrap items-center gap-1">
      <span
        v-for="tech in project.tech"
        :key="tech"
        class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300"
      >
        {{ tech }}
      </span>
      <span
        v-for="tag in project.tags"
        :key="tag"
        class="group inline-flex items-center gap-0.5 rounded bg-teal-50 py-0.5 pl-1.5 pr-1 text-[11px] text-teal-800 dark:bg-teal-900/40 dark:text-teal-300"
      >
        {{ tag }}
        <button
          class="rounded opacity-50 hover:opacity-100 group-hover:opacity-100"
          :title="`移除标签 ${tag}`"
          :aria-label="`移除标签 ${tag}`"
          @click="removeTag(tag)"
        >
          <X :size="11" />
        </button>
      </span>
      <input
        v-if="editingTag"
        ref="tagInput"
        v-model="tagDraft"
        maxlength="20"
        placeholder="标签名，回车确认"
        aria-label="新标签"
        class="field h-6 w-32 px-1.5 text-[11px]"
        @keydown.enter.prevent="commitTag"
        @keydown.esc="cancelTag"
        @blur="commitTag"
      />
      <button
        v-else
        class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        @click="startTag"
      >
        <Plus :size="11" /> 标签
      </button>
    </footer>
  </article>
</template>
