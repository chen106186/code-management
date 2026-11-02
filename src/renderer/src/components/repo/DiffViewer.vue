<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Columns2, Rows2 } from 'lucide-vue-next'
import type { DiffContent, DiffTarget } from '@shared/repo'
import { errorMessage } from '@renderer/lib/errors'

type MonacoModule = typeof import('@renderer/lib/monaco')
type DiffEditor = import('monaco-editor/editor/editor.api.js').editor.IStandaloneDiffEditor

const props = defineProps<{ repo: string; target: DiffTarget | null; version?: number }>()

const container = ref<HTMLElement | null>(null)
const content = shallowRef<DiffContent | null>(null)
const failure = ref<string | null>(null)
const sideBySide = ref(true)

let monacoModule: MonacoModule | null = null
let editor: DiffEditor | null = null
let requestId = 0
let shownKey = ''

const targetKey = (target: DiffTarget): string =>
  JSON.stringify([target.kind, target.path, target.origPath, target.kind === 'commit' ? target.hash : ''])

const showEditor = computed(
  () => !!props.target && !failure.value && !!content.value && !content.value.binary && !content.value.tooLarge
)

function render(target: DiffTarget, diff: DiffContent): void {
  if (!monacoModule || !editor) return
  const { monaco, languageOf } = monacoModule
  const previous = editor.getModel()
  const before = previous?.original.getValue()
  const after = previous?.modified.getValue()
  const key = targetKey(target)
  // 刷新时内容没变就不动编辑器，避免滚动位置被重置
  if (key === shownKey && previous && before === diff.original && after === diff.modified) return

  const language = languageOf(target.path)
  editor.setModel({
    original: monaco.editor.createModel(diff.original, language),
    modified: monaco.editor.createModel(diff.modified, language)
  })
  previous?.original.dispose()
  previous?.modified.dispose()
  shownKey = key
}

async function load(): Promise<void> {
  const target = props.target
  const id = ++requestId
  failure.value = null
  if (!target) {
    content.value = null
    return
  }
  try {
    // target 是响应式代理，IPC 无法克隆，要先转成普通对象
    const diff = await window.api.getDiff(props.repo, { ...target })
    if (id !== requestId) return
    content.value = diff
    if (!diff.binary && !diff.tooLarge) {
      await ensureEditor()
      if (id === requestId) render(target, diff)
    }
  } catch (e) {
    if (id === requestId) failure.value = errorMessage(e)
  }
}

async function ensureEditor(): Promise<void> {
  if (editor || !container.value) return
  monacoModule ??= await import('@renderer/lib/monaco')
  if (editor || !container.value) return
  editor = monacoModule.monaco.editor.createDiffEditor(container.value, {
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
    renderSideBySide: sideBySide.value,
    useInlineViewWhenSpaceIsLimited: false,
    renderOverviewRuler: false,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 12,
    hideUnchangedRegions: { enabled: true }
  })
}

watch(sideBySide, (value) => editor?.updateOptions({ renderSideBySide: value }))
watch(() => [props.target, props.version], load)
onMounted(load)

onBeforeUnmount(() => {
  requestId++
  const model = editor?.getModel()
  editor?.dispose()
  model?.original.dispose()
  model?.modified.dispose()
  editor = null
})
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col" data-testid="diff-viewer">
    <header
      v-if="target"
      class="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-700/70"
    >
      <span class="min-w-0 flex-1 truncate" :title="target.path">
        <template v-if="target.origPath">{{ target.origPath }} → </template>{{ target.path }}
      </span>
      <button
        class="icon-btn"
        :title="sideBySide ? '切换为行内视图' : '切换为并排视图'"
        :aria-label="sideBySide ? '切换为行内视图' : '切换为并排视图'"
        @click="sideBySide = !sideBySide"
      >
        <Rows2 v-if="sideBySide" :size="15" />
        <Columns2 v-else :size="15" />
      </button>
    </header>

    <div class="relative min-h-0 flex-1">
      <div ref="container" class="absolute inset-0" :class="showEditor ? '' : 'invisible'" />
      <p v-if="!target" class="absolute inset-x-0 top-16 text-center text-zinc-500">选择文件查看差异</p>
      <p v-else-if="failure" class="absolute inset-x-4 top-16 break-all text-center text-red-600 dark:text-red-400">
        {{ failure }}
      </p>
      <p v-else-if="content?.binary" class="absolute inset-x-0 top-16 text-center text-zinc-500">
        二进制文件，不显示差异
      </p>
      <p v-else-if="content?.tooLarge" class="absolute inset-x-0 top-16 text-center text-zinc-500">
        文件超过 2 MB，不显示差异
      </p>
    </div>
  </section>
</template>
