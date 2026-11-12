<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Pencil, Tag, Trash2 } from 'lucide-vue-next'
import TechIcon from '@renderer/components/TechIcon.vue'
import { techIcon } from '@renderer/lib/techIcons'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

const editing = ref<string | null>(null)
const draft = ref('')
const input = ref<HTMLInputElement | HTMLInputElement[] | null>(null)

const tags = computed(() =>
  store.allTags.map((tag) => ({
    tag,
    count: store.projects.filter((project) => project.tags.includes(tag)).length
  }))
)

async function start(tag: string): Promise<void> {
  editing.value = tag
  draft.value = tag
  await nextTick()
  const element = Array.isArray(input.value) ? input.value[0] : input.value
  element?.focus()
  element?.select()
}

function commit(): void {
  const from = editing.value
  const to = draft.value.trim()
  editing.value = null
  if (from && to && to !== from) void store.renameTag(from, to)
}
</script>

<template>
  <section class="space-y-2" data-testid="tag-manager">
    <h3 class="font-medium">标签</h3>
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      改名会更新所有项目；改成已有的标签就是合并，比如把 vue 合并到 Vue。
    </p>
    <ul class="space-y-1">
      <li
        v-for="{ tag, count } in tags"
        :key="tag"
        class="flex items-center gap-1.5 rounded-md bg-zinc-100 py-0.5 pl-2 pr-1 dark:bg-zinc-700/50"
        data-testid="tag-row"
      >
        <TechIcon v-if="techIcon(tag)" :name="tag" :size="12" />
        <Tag v-else :size="11" class="shrink-0 text-zinc-400" />
        <input
          v-if="editing === tag"
          ref="input"
          v-model="draft"
          maxlength="20"
          aria-label="标签名称"
          class="field h-6 min-w-0 flex-1 px-1.5 text-xs"
          @keydown.enter.prevent="commit"
          @keydown.esc.stop="editing = null"
          @blur="commit"
        />
        <template v-else>
          <span class="min-w-0 flex-1 truncate" :title="tag">{{ tag }}</span>
          <span class="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{{ count }}</span>
          <button class="icon-btn" :title="`重命名 ${tag}`" :aria-label="`重命名标签 ${tag}`" @click="start(tag)">
            <Pencil :size="13" />
          </button>
          <button class="icon-btn" :title="`删除 ${tag}`" :aria-label="`删除标签 ${tag}`" @click="store.deleteTag(tag)">
            <Trash2 :size="13" />
          </button>
        </template>
      </li>
      <li v-if="!tags.length" class="text-xs text-zinc-400">还没有标签</li>
    </ul>
  </section>
</template>
