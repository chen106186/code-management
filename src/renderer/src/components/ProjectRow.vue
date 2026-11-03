<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowDown, ArrowUp, CircleAlert, CircleCheck, FilePen, Folder, Star } from 'lucide-vue-next'
import type { Project } from '@shared/types'
import BranchSwitcher from '@renderer/components/BranchSwitcher.vue'
import ProjectActions from '@renderer/components/ProjectActions.vue'
import RemoteRow from '@renderer/components/RemoteRow.vue'
import SelectBox from '@renderer/components/SelectBox.vue'
import TechIcon from '@renderer/components/TechIcon.vue'
import { startProjectDrag } from '@renderer/lib/projectDrag'
import { branchLabel, changeCount, formatRelative } from '@renderer/lib/projectList'
import { useRemarkEditor } from '@renderer/lib/useRemarkEditor'
import { useProjectsStore } from '@renderer/stores/projects'

const props = defineProps<{ project: Project; index: number }>()
const store = useProjectsStore()
const router = useRouter()

const git = computed(() => props.project.git)
const changes = computed(() => changeCount(git.value))
const displayName = computed(() => props.project.remark ?? props.project.name)
const problem = computed(() =>
  props.project.missing ? '路径不存在' : props.project.gitError
)
/** 一行只放得下一个地址，优先显示 origin，其余的在悬停提示里 */
const remotes = computed(() => git.value?.remotes ?? [])
const mainRemote = computed(
  () => remotes.value.find((remote) => remote.name === 'origin') ?? remotes.value[0]
)
const otherRemotes = computed(() =>
  remotes.value
    .filter((remote) => remote !== mainRemote.value)
    .map((remote) => `${remote.name}：${remote.url}`)
)

const {
  editing: editingRemark,
  draft: remarkDraft,
  input: remarkInput,
  start: startRemark,
  commit: commitRemark,
  cancel: cancelRemark
} = useRemarkEditor(() => props.project)

function openRepo(): void {
  void router.push({ name: 'repo', query: { path: props.project.path } })
}
</script>

<template>
  <li
    data-testid="project-row"
    :draggable="!editingRemark"
    class="project-row project-grid group/card relative h-11 text-xs transition-colors"
    :class="
      store.selected.has(project.path)
        ? 'bg-teal-50 dark:bg-teal-900/20'
        : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/30'
    "
    @dragstart="startProjectDrag($event, store.dragPaths(project.path))"
  >
    <span class="text-right tabular-nums text-zinc-400" data-testid="project-index">{{ index }}</span>
    <SelectBox :path="project.path" :label="displayName" />
    <button
      class="shrink-0"
      :class="project.favorite ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/card:opacity-100'"
      :title="project.favorite ? '取消收藏' : '收藏'"
      :aria-label="project.favorite ? '取消收藏' : '收藏'"
      :aria-pressed="project.favorite"
      @click="store.toggleFavorite(project.path)"
    >
      <Star
        :size="14"
        :class="project.favorite ? 'fill-amber-400 text-amber-400' : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
      />
    </button>
    <span class="flex w-5 shrink-0 justify-center text-zinc-500 dark:text-zinc-300">
      <TechIcon v-if="project.tech[0]" :name="project.tech[0]" :size="15" />
      <Folder v-else :size="15" />
    </span>

    <div class="min-w-0" :title="project.path">
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
      <p v-else class="flex min-w-0 items-baseline gap-2">
        <button
          v-if="git"
          class="min-w-0 truncate rounded text-left text-[13px] font-semibold hover:text-teal-700 hover:underline dark:hover:text-teal-400"
          title="打开仓库"
          @click="openRepo"
        >
          {{ displayName }}
        </button>
        <span v-else class="min-w-0 truncate text-[13px] font-semibold">{{ displayName }}</span>
        <span v-if="project.remark" class="min-w-0 max-w-[50%] shrink-0 truncate text-zinc-400">
          {{ project.name }}
        </span>
      </p>
    </div>

    <p
      v-if="problem"
      class="col-span-4 flex min-w-0 items-center gap-1.5 text-red-600 dark:text-red-400"
      :title="problem"
    >
      <CircleAlert :size="13" class="shrink-0" />
      <span class="truncate">{{ problem }}</span>
    </p>

    <template v-else-if="git">
      <div class="flex min-w-0 items-center">
        <BranchSwitcher :project="project" :label="branchLabel(git)" />
      </div>
      <div class="flex min-w-0 items-center gap-2 tabular-nums">
        <span v-if="git.ahead" class="flex items-center text-teal-700 dark:text-teal-400" :title="`领先上游 ${git.ahead} 个提交`">
          <ArrowUp :size="12" />{{ git.ahead }}
        </span>
        <span v-if="git.behind" class="flex items-center text-amber-700 dark:text-amber-400" :title="`落后上游 ${git.behind} 个提交`">
          <ArrowDown :size="12" />{{ git.behind }}
        </span>
        <span v-if="changes" class="flex items-center gap-0.5 text-amber-700 dark:text-amber-400" :title="`${changes} 个文件有改动`">
          <FilePen :size="12" />{{ changes }}
        </span>
        <span v-else-if="!git.ahead && !git.behind" class="text-zinc-400" title="工作区干净">
          <CircleCheck :size="12" />
        </span>
      </div>
      <div v-if="mainRemote" class="flex min-w-0 items-center gap-1">
        <RemoteRow
          :project-path="project.path"
          :remote="mainRemote"
          :show-name="false"
          short
          class="min-w-0 flex-1"
        />
        <span
          v-if="otherRemotes.length"
          class="shrink-0 rounded bg-zinc-100 px-1 text-[11px] text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400"
          :title="otherRemotes.join('\n')"
        >
          +{{ otherRemotes.length }}
        </span>
      </div>
      <span v-else class="truncate text-zinc-400">未配置</span>
      <span class="min-w-0 truncate text-zinc-500 dark:text-zinc-400" :title="git.lastCommit?.subject">
        {{ git.lastCommit?.subject ?? '尚无提交' }}
      </span>
    </template>

    <span v-else class="col-span-4 min-w-0 truncate text-zinc-400">未使用 Git</span>

    <span class="truncate text-right text-zinc-400">
      {{ project.lastActivity ? formatRelative(project.lastActivity) : '' }}
    </span>

    <ProjectActions
      v-if="!editingRemark"
      :project="project"
      class="absolute right-2 top-1/2 -translate-y-1/2"
      @edit-remark="startRemark"
    />
  </li>
</template>
