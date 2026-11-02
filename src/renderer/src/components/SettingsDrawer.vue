<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { CircleAlert, FolderMinus, FolderPlus, RotateCcw, Trash2, X } from 'lucide-vue-next'
import { useProjectsStore } from '@renderer/stores/projects'

const emit = defineEmits<{ close: [] }>()
const store = useProjectsStore()

const onKey = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function errorOf(path: string): string | undefined {
  return store.scanErrors.find((e) => e.path === path)?.message
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex justify-end bg-black/30" @click.self="emit('close')">
    <aside
      role="dialog"
      aria-label="扫描设置"
      class="flex h-full w-[26rem] max-w-full flex-col gap-5 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <header class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">扫描设置</h2>
        <button class="icon-btn" title="关闭" aria-label="关闭" @click="emit('close')">
          <X :size="16" />
        </button>
      </header>

      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">根目录</h3>
          <button class="btn h-7 text-xs" @click="store.addRoot()">
            <FolderPlus :size="13" /> 添加
          </button>
        </div>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          自动查找其中最多三层的项目。移除根目录不会删除任何文件。
        </p>
        <ul class="space-y-1">
          <li
            v-for="root in store.config.roots"
            :key="root"
            class="rounded-md bg-zinc-100 py-1 pl-2 pr-1 dark:bg-zinc-700/50"
          >
            <div class="flex items-center gap-1">
              <span class="min-w-0 flex-1 truncate" :title="root">{{ root }}</span>
              <button
                class="icon-btn"
                title="移除根目录"
                aria-label="移除根目录"
                @click="store.removeRoot(root)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
            <p
              v-if="errorOf(root)"
              class="flex items-start gap-1 pb-1 text-xs text-red-600 dark:text-red-400"
            >
              <CircleAlert :size="13" class="mt-px shrink-0" />
              <span class="break-all">{{ errorOf(root) }}</span>
            </p>
          </li>
          <li v-if="!store.config.roots.length" class="text-xs text-zinc-400">还没有根目录</li>
        </ul>
      </section>

      <section class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="font-medium">排除目录</h3>
          <button class="btn h-7 text-xs" @click="store.addExcluded()">
            <FolderMinus :size="13" /> 添加
          </button>
        </div>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          扫描时跳过这些目录及其子目录。手动添加的项目不受影响，也不会删除任何文件。
        </p>
        <ul class="space-y-1">
          <li
            v-for="path in store.config.excluded"
            :key="path"
            class="flex items-center gap-1 rounded-md bg-zinc-100 py-1 pl-2 pr-1 dark:bg-zinc-700/50"
          >
            <span class="min-w-0 flex-1 truncate" :title="path">{{ path }}</span>
            <button
              class="icon-btn"
              title="取消排除"
              aria-label="取消排除"
              @click="store.removeExcluded(path)"
            >
              <Trash2 :size="14" />
            </button>
          </li>
          <li v-if="!store.config.excluded.length" class="text-xs text-zinc-400">没有排除的目录</li>
        </ul>
      </section>

      <section class="space-y-2">
        <h3 class="font-medium">已隐藏的项目</h3>
        <ul class="space-y-1">
          <li
            v-for="path in store.config.hidden"
            :key="path"
            class="flex items-center gap-1 rounded-md bg-zinc-100 py-1 pl-2 pr-1 dark:bg-zinc-700/50"
          >
            <span class="min-w-0 flex-1 truncate" :title="path">{{ path }}</span>
            <button
              class="icon-btn"
              title="恢复显示"
              aria-label="恢复显示"
              @click="store.restoreProject(path)"
            >
              <RotateCcw :size="14" />
            </button>
          </li>
          <li v-if="!store.config.hidden.length" class="text-xs text-zinc-400">没有隐藏的项目</li>
        </ul>
      </section>
    </aside>
  </div>
</template>
