<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Check, Copy, ExternalLink, Link2 } from 'lucide-vue-next'
import { remoteShortUrl, remoteWebUrl } from '@shared/remotes'
import type { RemoteInfo } from '@shared/types'
import { useProjectsStore } from '@renderer/stores/projects'

const props = defineProps<{
  projectPath: string
  remote: RemoteInfo
  showName: boolean
  short?: boolean
}>()
const store = useProjectsStore()

const COPIED_FEEDBACK_MS = 1500

const canOpen = computed(() => remoteWebUrl(props.remote.url) !== null)
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

async function copy(): Promise<void> {
  if (!(await store.copyText(props.remote.url))) return
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), COPIED_FEEDBACK_MS)
}

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <div class="flex h-5 items-center gap-1 text-zinc-500 dark:text-zinc-400" data-testid="remote-row">
    <Link2 :size="13" class="shrink-0 text-zinc-400" />
    <span v-if="showName" class="shrink-0 rounded bg-zinc-100 px-1 text-[11px] dark:bg-zinc-700/60">
      {{ remote.name }}
    </span>
    <span class="min-w-0 flex-1 truncate" :title="remote.url" data-testid="remote-url">{{ short ? remoteShortUrl(remote.url) : remote.url }}</span>
    <button
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      :class="copied ? '' : 'opacity-0 focus-visible:opacity-100 group-hover/card:opacity-100'"
      :title="copied ? '已复制' : '复制地址'"
      :aria-label="copied ? '已复制' : '复制地址'"
      @click="copy"
    >
      <Check v-if="copied" :size="13" class="text-teal-600 dark:text-teal-400" />
      <Copy v-else :size="12" />
    </button>
    <button
      v-if="canOpen"
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:opacity-100 group-hover/card:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      title="在浏览器打开"
      aria-label="在浏览器打开"
      @click="store.openRemote(projectPath, remote.name)"
    >
      <ExternalLink :size="12" />
    </button>
  </div>
</template>
