<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Archive, CircleAlert, FileText, HardDrive, LoaderCircle } from 'lucide-vue-next'
import type { Readme } from '@shared/types'
import { errorMessage } from '@renderer/lib/errors'
import { IMAGE_SOURCE_ATTR, localImagePath, renderMarkdown } from '@renderer/lib/markdown'
import { formatBytes, languageShares } from '@renderer/lib/projectList'
import { useProjectsStore } from '@renderer/stores/projects'
import { useRepoStore } from '@renderer/stores/repo'

const MAX_LANGUAGES = 6

const repo = useRepoStore()
const projects = useProjectsStore()

const readme = ref<Readme | null>(null)
const loading = ref(true)
const failure = ref<string | null>(null)
const body = ref<HTMLElement | null>(null)

const project = computed(() => projects.projects.find((p) => p.path === repo.path))
const stats = computed(() => project.value?.stats ?? null)
const stashCount = computed(() => repo.changes?.status.stashCount ?? 0)
const languages = computed(() => (stats.value ? languageShares(stats.value).slice(0, MAX_LANGUAGES) : []))
const html = computed(() =>
  readme.value?.markdown ? renderMarkdown(readme.value.content) : ''
)

/** 本地图片换成主进程读到的内容，读不到的和远程图片都显示替代文字 */
async function loadImages(): Promise<void> {
  const path = repo.path
  if (!path) return
  await nextTick()
  const images = body.value?.querySelectorAll<HTMLImageElement>(`img[${IMAGE_SOURCE_ATTR}]`) ?? []
  await Promise.all(
    [...images].map(async (image) => {
      const source = image.getAttribute(IMAGE_SOURCE_ATTR) ?? ''
      const local = localImagePath(source)
      const url = /^data:image\//i.test(source)
        ? source
        : local && (await window.api.getReadmeImage(path, local))
      if (url) {
        image.src = url
        return
      }
      const placeholder = document.createElement('span')
      placeholder.className = 'readme-image-placeholder'
      placeholder.textContent = image.alt || '图片'
      placeholder.title = local ? '图片读取失败' : `未加载远程图片：${source}`
      image.replaceWith(placeholder)
    })
  )
}

watch(
  () => repo.path,
  async (path) => {
    readme.value = null
    failure.value = null
    if (!path) return
    loading.value = true
    try {
      const next = await window.api.getReadme(path)
      if (path !== repo.path) return
      readme.value = next
      // 正文要先显示出来才找得到其中的图片
      loading.value = false
      await loadImages()
    } catch (e) {
      failure.value = errorMessage(e)
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

/** 链接只交给系统浏览器打开，页内的相对链接没有可去的地方 */
function onClick(event: MouseEvent): void {
  const link = (event.target as Element).closest('a')
  if (!link) return
  event.preventDefault()
  if (/^https?:/i.test(link.href)) window.open(link.href)
}
</script>

<template>
  <div class="min-w-0 flex-1 overflow-y-auto p-4" data-testid="repo-info">
    <div class="mx-auto max-w-4xl space-y-4">
      <section
        class="grid gap-4 rounded-xl border border-zinc-200 bg-white p-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] dark:border-zinc-700/70 dark:bg-zinc-800/60"
      >
        <dl class="space-y-2 text-xs">
          <div class="flex items-center gap-1.5">
            <HardDrive :size="13" class="shrink-0 text-zinc-400" />
            <dt class="text-zinc-500 dark:text-zinc-400">磁盘占用</dt>
            <dd class="ml-auto font-medium tabular-nums" data-testid="info-size">
              {{ stats ? formatBytes(stats.size) : '统计中…' }}
            </dd>
          </div>
          <div v-if="stats?.generatedSize" class="flex items-center gap-1.5 pl-5">
            <dt class="text-zinc-500 dark:text-zinc-400">依赖和构建产物</dt>
            <dd class="ml-auto tabular-nums">{{ formatBytes(stats.generatedSize) }}</dd>
          </div>
          <div class="flex items-center gap-1.5">
            <FileText :size="13" class="shrink-0 text-zinc-400" />
            <dt class="text-zinc-500 dark:text-zinc-400">代码行数</dt>
            <dd class="ml-auto font-medium tabular-nums" data-testid="info-lines">
              {{ stats ? stats.lines.toLocaleString('zh-CN') : '统计中…' }}
            </dd>
          </div>
          <div class="flex items-center gap-1.5">
            <Archive :size="13" class="shrink-0 text-zinc-400" />
            <dt class="text-zinc-500 dark:text-zinc-400">Stash</dt>
            <dd class="ml-auto font-medium tabular-nums" data-testid="info-stash">{{ stashCount }}</dd>
          </div>
          <p v-if="stats?.truncated" class="text-zinc-400">项目太大，只统计了一部分</p>
        </dl>

        <ul v-if="languages.length" class="space-y-1.5 text-xs" aria-label="语言占比" data-testid="info-languages">
          <li
            v-for="language in languages"
            :key="language.name"
            class="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2"
            :title="`${language.name}：${language.lines.toLocaleString('zh-CN')} 行`"
          >
            <span class="truncate">{{ language.name }}</span>
            <span class="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-700/60">
              <span
                class="block h-full rounded-full bg-teal-600 dark:bg-teal-400"
                :style="{ width: `${Math.max(language.percent, 1)}%` }"
              />
            </span>
            <span class="text-right tabular-nums text-zinc-500 dark:text-zinc-400">{{ language.percent }}%</span>
          </li>
        </ul>
        <p v-else class="self-center text-xs text-zinc-400">
          {{ stats ? '没有识别到代码文件' : '正在后台统计语言占比…' }}
        </p>
      </section>

      <section
        class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/70 dark:bg-zinc-800/60"
        aria-label="README"
      >
        <p v-if="loading" class="flex items-center gap-2 text-zinc-500">
          <LoaderCircle :size="14" class="animate-spin" /> 正在读取 README…
        </p>
        <p v-else-if="failure" class="flex items-center gap-2 text-red-600 dark:text-red-400">
          <CircleAlert :size="14" class="shrink-0" /> {{ failure }}
        </p>
        <p v-else-if="!readme" class="py-6 text-center text-zinc-500" data-testid="readme-empty">
          这个项目没有 README
        </p>
        <template v-else>
          <p class="mb-3 text-xs text-zinc-400">{{ readme.name }}</p>
          <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown 已过滤 -->
          <div
            v-if="readme.markdown"
            ref="body"
            class="markdown-body"
            data-testid="readme-body"
            @click="onClick"
            v-html="html"
          />
          <pre v-else class="whitespace-pre-wrap break-words font-mono text-xs leading-5" data-testid="readme-body">{{ readme.content }}</pre>
          <p v-if="readme.truncated" class="mt-3 text-xs text-zinc-400">文件太大，只显示了开头部分</p>
        </template>
      </section>
    </div>
  </div>
</template>
