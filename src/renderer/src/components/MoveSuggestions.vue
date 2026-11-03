<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, FolderSync } from 'lucide-vue-next'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()
const allFrom = computed(() => store.moves.map((move) => move.from))
</script>

<template>
  <section
    aria-label="项目移动提示"
    data-testid="move-suggestions"
    class="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900 dark:bg-amber-950/30"
  >
    <div class="flex items-center gap-2">
      <FolderSync :size="14" class="shrink-0 text-amber-700 dark:text-amber-400" />
      <p class="min-w-0 flex-1">
        发现 {{ store.moves.length }} 个项目可能移动过位置（Git 地址相同），可以把备注、分类、标签和收藏转过去。
      </p>
      <template v-if="store.moves.length > 1">
        <button class="btn h-7 text-xs" @click="store.applyMoves(allFrom)">全部迁移</button>
        <button class="btn h-7 text-xs" @click="store.dismissMoves(allFrom)">全部忽略</button>
      </template>
    </div>
    <ul class="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
      <li v-for="move in store.moves" :key="move.from" class="flex items-center gap-2 text-xs">
        <span class="shrink-0 font-medium">{{ move.name }}</span>
        <!-- 两个路径各自截断，否则长路径会把新位置挤得看不见 -->
        <span class="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300" :title="move.from">{{ move.from }}</span>
        <ArrowRight :size="11" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300" :title="move.to">{{ move.to }}</span>
        <button class="btn h-6 px-2 text-xs" data-testid="move-apply" @click="store.applyMoves([move.from])">迁移</button>
        <button class="btn h-6 px-2 text-xs" data-testid="move-dismiss" @click="store.dismissMoves([move.from])">忽略</button>
      </li>
    </ul>
  </section>
</template>
