<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CircleAlert, Download, FolderMinus, FolderPlus, RefreshCw, Trash2, Upload, X } from 'lucide-vue-next'
import { AUTO_FETCH_OPTIONS } from '@shared/types'
import TagManager from '@renderer/components/TagManager.vue'
import { formatRelative } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'

const emit = defineEmits<{ close: [] }>()
const store = useProjectsStore()

const backupNotice = ref('')
const statsNotice = ref('')

const intervalLabel = (minutes: number): string => {
  if (!minutes) return '关闭'
  return minutes < 60 ? `每 ${minutes} 分钟` : `每 ${minutes / 60} 小时`
}

const lastFetchText = computed(() => {
  const { lastRun, succeeded, failed } = store.autoFetchStatus
  if (lastRun === null) return '本次启动后还没有运行过'
  const result = failed.length ? `成功 ${succeeded} 个，失败 ${failed.length} 个` : `成功 ${succeeded} 个`
  return `上次运行：${formatRelative(lastRun)}，${result}`
})

function recomputeStats(): void {
  void store.recomputeStats()
  statsNotice.value = '已开始重新统计，结果会陆续更新'
}

async function exportConfig(): Promise<void> {
  const path = await store.exportConfig()
  if (path) backupNotice.value = `已导出到 ${path}`
}

async function importConfig(): Promise<void> {
  if (await store.importConfig()) backupNotice.value = '已导入，原配置备份在数据目录'
}

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
      aria-label="设置"
      class="flex h-full w-[26rem] max-w-full flex-col gap-5 overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <header class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">设置</h2>
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
        <h3 class="font-medium">后台运行</h3>
        <label class="flex items-center justify-between gap-2">
          <span>自动 Fetch</span>
          <select
            class="field h-7"
            data-testid="auto-fetch-minutes"
            :value="store.config.autoFetchMinutes"
            @change="store.setAutoFetchMinutes(Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="minutes in AUTO_FETCH_OPTIONS" :key="minutes" :value="minutes">
              {{ intervalLabel(minutes) }}
            </option>
          </select>
        </label>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          只更新远程跟踪分支，不改动工作区和本地分支；需要输入密码的仓库会跳过。
        </p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="auto-fetch-status">{{ lastFetchText }}</p>
        <ul v-if="store.autoFetchStatus.failed.length" class="space-y-0.5 text-xs text-red-600 dark:text-red-400">
          <li
            v-for="item in store.autoFetchStatus.failed"
            :key="item.name"
            class="truncate"
            :title="item.message"
          >
            {{ item.name }}：{{ item.message }}
          </li>
        </ul>
        <label class="flex items-start gap-2">
          <input
            type="checkbox"
            class="mt-0.5 accent-teal-600"
            data-testid="close-to-tray"
            :checked="store.config.closeToTray"
            @change="store.setCloseToTray(($event.target as HTMLInputElement).checked)"
          />
          <span>
            关闭窗口后留在托盘
            <span class="block text-xs text-zinc-500 dark:text-zinc-400">
              自动 Fetch 继续运行，有项目落后远程时发通知；从托盘菜单退出。
            </span>
          </span>
        </label>
      </section>

      <section class="space-y-2">
        <h3 class="font-medium">项目统计</h3>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          磁盘占用、代码行数和语言占比在后台统计，每天自动更新一次。
        </p>
        <button class="btn h-7 text-xs" data-testid="recompute-stats" @click="recomputeStats">
          <RefreshCw :size="13" /> 重新统计
        </button>
        <p v-if="statsNotice" role="status" class="text-xs text-teal-700 dark:text-teal-400">{{ statsNotice }}</p>
      </section>

      <TagManager />

      <section class="space-y-2">
        <h3 class="font-medium">备份配置</h3>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          导出根目录、分类、备注、标签、收藏和视图，可用于备份或换电脑。导入会替换当前全部配置，替换前自动备份。
        </p>
        <div class="flex gap-2">
          <button class="btn h-7 text-xs" data-testid="export-config" @click="exportConfig">
            <Upload :size="13" /> 导出
          </button>
          <button class="btn h-7 text-xs" data-testid="import-config" @click="importConfig">
            <Download :size="13" /> 导入
          </button>
        </div>
        <p v-if="backupNotice" role="status" class="break-all text-xs text-teal-700 dark:text-teal-400">
          {{ backupNotice }}
        </p>
      </section>
    </aside>
  </div>
</template>
