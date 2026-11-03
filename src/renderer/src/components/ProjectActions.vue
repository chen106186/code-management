<script setup lang="ts">
import { Code2, EyeOff, FolderOpen, Pencil, Terminal } from 'lucide-vue-next'
import type { Project } from '@shared/types'
import { useProjectsStore } from '@renderer/stores/projects'

defineProps<{ project: Project }>()
const emit = defineEmits<{ editRemark: [] }>()
const store = useProjectsStore()
</script>

<template>
  <div
    class="flex rounded-md bg-white opacity-0 shadow-sm ring-1 ring-zinc-200 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 dark:bg-zinc-800 dark:ring-zinc-700"
    data-testid="project-actions"
  >
    <button
      class="icon-btn"
      :title="project.remark ? '修改备注' : '添加备注'"
      aria-label="编辑备注"
      @click="emit('editRemark')"
    >
      <Pencil :size="14" />
    </button>
    <template v-if="!project.missing">
      <button class="icon-btn" title="用 VS Code 打开" aria-label="用 VS Code 打开" @click="store.openInEditor(project.path)">
        <Code2 :size="15" />
      </button>
      <button class="icon-btn" title="在终端打开" aria-label="在终端打开" @click="store.openInTerminal(project.path)">
        <Terminal :size="15" />
      </button>
      <button class="icon-btn" title="在资源管理器打开" aria-label="在资源管理器打开" @click="store.openInExplorer(project.path)">
        <FolderOpen :size="15" />
      </button>
    </template>
    <button class="icon-btn" title="从列表隐藏（不会删除文件）" aria-label="从列表隐藏" @click="store.hideProject(project.path)">
      <EyeOff :size="15" />
    </button>
  </div>
</template>
