<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clock,
  CloudOff,
  FilePen,
  FilePlus,
  Folder,
  GitCommitHorizontal,
  Plus,
  Star,
  Tag,
  TriangleAlert,
  Unlink,
  X
} from 'lucide-vue-next'
import { flattenCategories } from '@shared/categories'
import type { Project } from '@shared/types'
import BranchSwitcher from '@renderer/components/BranchSwitcher.vue'
import ProjectActions from '@renderer/components/ProjectActions.vue'
import RemoteRow from '@renderer/components/RemoteRow.vue'
import SelectBox from '@renderer/components/SelectBox.vue'
import TechIcon from '@renderer/components/TechIcon.vue'
import { startProjectDrag } from '@renderer/lib/projectDrag'
import { branchLabel as labelOfBranch, changeCount, formatRelative } from '@renderer/lib/projectList'
import { techIcon } from '@renderer/lib/techIcons'
import { useRemarkEditor } from '@renderer/lib/useRemarkEditor'
import { useProjectsStore } from '@renderer/stores/projects'

const props = defineProps<{ project: Project }>()
const store = useProjectsStore()
const router = useRouter()

// 下拉框要列出所有分类，不受左侧折叠影响
const categoryOptions = computed(() => flattenCategories(store.categories))

function onCategoryChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  void store.setProjectCategory(props.project.path, value || null)
}

function onDragStart(event: DragEvent): void {
  startProjectDrag(event, store.dragPaths(props.project.path))
}

function openRepo(): void {
  void router.push({ name: 'repo', query: { path: props.project.path } })
}

const git = computed(() => props.project.git)
const primaryTech = computed(() => props.project.tech[0])
const changes = computed(() => changeCount(git.value))
const branchLabel = computed(() => labelOfBranch(git.value))
const changeParts = computed(() => {
  const g = git.value
  if (!g) return []
  return [
    { label: '冲突', count: g.conflicted, icon: TriangleAlert, tone: 'text-red-600 dark:text-red-400' },
    { label: '已暂存', count: g.staged, icon: CircleDot, tone: 'text-teal-700 dark:text-teal-400' },
    { label: '未暂存', count: g.unstaged, icon: FilePen, tone: 'text-amber-700 dark:text-amber-400' },
    { label: '未跟踪', count: g.untracked, icon: FilePlus, tone: 'text-zinc-500 dark:text-zinc-400' }
  ].filter((part) => part.count > 0)
})

const displayName = computed(() => props.project.remark ?? props.project.name)

const {
  editing: editingRemark,
  draft: remarkDraft,
  input: remarkInput,
  start: startRemark,
  commit: commitRemark,
  cancel: cancelRemark
} = useRemarkEditor(() => props.project)

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
    :draggable="!editingRemark"
    class="group/card relative flex min-w-0 flex-col rounded-xl border bg-white transition-shadow hover:shadow-md dark:bg-zinc-800/60"
    :class="
      store.selected.has(project.path)
        ? 'border-teal-500 ring-1 ring-teal-500'
        : 'border-zinc-200 dark:border-zinc-700/70'
    "
    @dragstart="onDragStart"
  >
    <SelectBox :path="project.path" :label="displayName" class="absolute left-1.5 top-1.5 z-[1]" />
    <!-- 标题：图标、名称、路径；操作按钮悬停时才出现，平时不占视线 -->
    <header class="flex items-center gap-3 px-4 pt-3.5">
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-300"
        data-testid="project-icon"
      >
        <TechIcon v-if="primaryTech" :name="primaryTech" :size="20" />
        <Folder v-else :size="18" />
      </span>
      <div class="min-w-0 flex-1">
        <input
          v-if="editingRemark"
          ref="remarkInput"
          v-model="remarkDraft"
          maxlength="60"
          placeholder="项目的具体名称，留空可清除"
          aria-label="项目备注"
          class="field h-6 w-full px-1.5 text-xs"
          @keydown.enter.prevent="commitRemark"
          @keydown.esc="cancelRemark"
          @blur="commitRemark"
        />
        <h2 v-else class="flex min-w-0 items-baseline gap-2 text-sm leading-5" :title="displayName">
          <button
            v-if="git"
            class="min-w-0 truncate rounded text-left font-semibold hover:text-teal-700 hover:underline dark:hover:text-teal-400"
            title="打开仓库"
            @click="openRepo"
          >
            {{ displayName }}
          </button>
          <span v-else class="min-w-0 truncate font-semibold">{{ displayName }}</span>
          <!-- 有备注时保留文件夹名，方便和磁盘上的目录对照 -->
          <span
            v-if="project.remark"
            class="min-w-0 max-w-[50%] shrink-0 truncate text-xs text-zinc-400"
            data-testid="project-folder-name"
            :title="project.name"
          >
            {{ project.name }}
          </span>
        </h2>
        <p class="truncate text-xs leading-4 text-zinc-500 dark:text-zinc-400" :title="project.path">
          {{ project.path }}
        </p>
      </div>
      <button
        class="icon-btn -mr-1 self-start"
        :class="project.favorite ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/card:opacity-100'"
        :title="project.favorite ? '取消收藏' : '收藏'"
        :aria-label="project.favorite ? '取消收藏' : '收藏'"
        :aria-pressed="project.favorite"
        @click="store.toggleFavorite(project.path)"
      >
        <Star :size="15" :class="project.favorite ? 'fill-amber-400 text-amber-400' : ''" />
      </button>
      <ProjectActions
        v-if="!editingRemark"
        :project="project"
        class="absolute right-11 top-3"
        @edit-remark="startRemark"
      />
    </header>

    <!-- 状态：分支和改动一行，最后提交一行 -->
    <div class="flex-1 space-y-1.5 px-4 py-3 text-xs">
      <p v-if="project.missing" class="flex items-center gap-1.5 text-red-600 dark:text-red-400">
        <CircleAlert :size="13" class="shrink-0" /> 路径不存在
      </p>

      <p
        v-else-if="project.gitError"
        class="flex items-start gap-1.5 text-red-600 dark:text-red-400"
        :title="project.gitError"
      >
        <CircleAlert :size="13" class="mt-px shrink-0" />
        <span class="line-clamp-2 break-all">{{ project.gitError }}</span>
      </p>

      <template v-else-if="git">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <BranchSwitcher :project="project" :label="branchLabel" />
          <span
            v-if="git.ahead"
            class="flex items-center gap-0.5 tabular-nums text-teal-700 dark:text-teal-400"
            :title="`领先上游 ${git.ahead} 个提交`"
          >
            <ArrowUp :size="12" />{{ git.ahead }}
          </span>
          <span
            v-if="git.behind"
            class="flex items-center gap-0.5 tabular-nums text-amber-700 dark:text-amber-400"
            :title="`落后上游 ${git.behind} 个提交`"
          >
            <ArrowDown :size="12" />{{ git.behind }}
          </span>
          <span v-if="git.head && !git.upstream" class="flex items-center gap-1 text-zinc-400" title="当前分支没有上游">
            <CloudOff :size="12" /> 无上游
          </span>
          <span
            v-for="part in changeParts"
            :key="part.label"
            class="flex items-center gap-1 tabular-nums"
            :class="part.tone"
          >
            <component :is="part.icon" :size="12" /> {{ part.count }} {{ part.label }}
          </span>
          <span v-if="!changes" class="flex items-center gap-1 text-zinc-400">
            <CircleCheck :size="12" /> 工作区干净
          </span>
        </div>
        <div v-if="git.lastCommit" class="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <span class="flex min-w-0 flex-1 items-center gap-1" :title="git.lastCommit.subject">
            <GitCommitHorizontal :size="13" class="shrink-0 text-zinc-400" />
            <span class="truncate">{{ git.lastCommit.subject }}</span>
          </span>
          <span class="flex shrink-0 items-center gap-1 text-zinc-400">
            <Clock :size="12" /> {{ formatRelative(git.lastCommit.time) }}
          </span>
        </div>
        <p v-else class="flex items-center gap-1 text-zinc-400">
          <GitCommitHorizontal :size="13" /> 尚无提交
        </p>
        <RemoteRow
          v-for="remote in git.remotes"
          :key="remote.name"
          :project-path="project.path"
          :remote="remote"
          :show-name="git.remotes.length > 1"
        />
        <p v-if="!git.remotes.length" class="flex h-5 items-center gap-1 text-zinc-400">
          <Unlink :size="12" class="shrink-0" /> 未配置远程地址
        </p>
      </template>

      <template v-else>
        <p class="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <Folder :size="13" class="shrink-0 text-zinc-400" /> 未使用 Git
        </p>
        <p v-if="project.lastActivity" class="flex items-center gap-1 text-zinc-400">
          <Clock :size="12" /> 文件修改于 {{ formatRelative(project.lastActivity) }}
        </p>
      </template>
    </div>

    <!-- 底部：技术栈和标签在左，分类固定在右 -->
    <footer
      class="flex items-center gap-2 border-t border-zinc-100 px-4 py-2 dark:border-zinc-700/50"
    >
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        <span
          v-for="tech in project.tech"
          :key="tech"
          class="inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300"
        >
          <TechIcon :name="tech" :size="11" />
          {{ tech }}
        </span>
        <span
          v-for="tag in project.tags"
          :key="tag"
          class="group inline-flex items-center gap-1 rounded bg-teal-50 py-0.5 pl-1.5 pr-1 text-[11px] text-teal-800 dark:bg-teal-900/40 dark:text-teal-300"
        >
          <TechIcon v-if="techIcon(tag)" :name="tag" :size="11" data-testid="tag-tech-icon" />
          <Tag v-else :size="10" class="shrink-0" data-testid="tag-plain-icon" />
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
      </div>

      <label
        v-if="categoryOptions.length"
        class="relative flex shrink-0 items-center text-zinc-500 dark:text-zinc-400"
        title="项目分类"
      >
        <Folder :size="12" class="pointer-events-none absolute left-1.5" />
        <select
          :value="project.categoryId ?? ''"
          aria-label="项目分类"
          class="h-6 max-w-[8.5rem] appearance-none truncate rounded-md bg-zinc-100 pl-6 pr-5 text-[11px] text-zinc-700 hover:bg-zinc-200/70 dark:bg-zinc-700/60 dark:text-zinc-200 dark:hover:bg-zinc-700"
          @change="onCategoryChange"
        >
          <option value="">未分类</option>
          <option v-for="{ category, depth } in categoryOptions" :key="category.id" :value="category.id">
            {{ '　'.repeat(depth) }}{{ category.name }}
          </option>
        </select>
        <ChevronDown :size="12" class="pointer-events-none absolute right-1" />
      </label>
    </footer>
  </article>
</template>
