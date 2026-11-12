<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LoaderCircle } from 'lucide-vue-next'
import type { Activity } from '@shared/types'
import { errorMessage } from '@renderer/lib/errors'
import { aggregateActivity, buildWeeks, levelThresholds, levelOf, monthLabels } from '@renderer/lib/activityGrid'
import { useProjectsStore } from '@renderer/stores/projects'

const store = useProjectsStore()

/** 同一个色系从浅到深，深色模式下反过来，提交越多越醒目 */
const LEVELS = [
  'bg-zinc-200/70 dark:bg-zinc-700/50',
  'bg-teal-200 dark:bg-teal-900',
  'bg-teal-400 dark:bg-teal-700',
  'bg-teal-600 dark:bg-teal-500',
  'bg-teal-800 dark:bg-teal-300'
]

const mineOnly = ref(true)
const activity = ref<Activity>({})
const loading = ref(false)
const failure = ref<string | null>(null)
const hovered = ref<string | null>(null)
let requestId = 0

async function load(): Promise<void> {
  const id = ++requestId
  loading.value = true
  try {
    const next = await window.api.getActivity(mineOnly.value)
    if (id !== requestId) return
    activity.value = next
    failure.value = null
  } catch (e) {
    if (id === requestId) failure.value = errorMessage(e)
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch(mineOnly, load, { immediate: true })

const days = computed(() => aggregateActivity(activity.value, store.scopedProjects))
const weeks = computed(() => buildWeeks(new Date()))
const months = computed(() => monthLabels(weeks.value))
const thresholds = computed(() => levelThresholds([...days.value.values()].map((d) => d.total)))
const total = computed(() => [...days.value.values()].reduce((sum, day) => sum + day.total, 0))

const hoveredText = computed(() => {
  if (!hovered.value) return null
  const day = days.value.get(hovered.value)
  if (!day) return `${hovered.value}：没有提交`
  const names = day.projects.slice(0, 3).map((p) => `${p.name} ${p.count}`).join('、')
  const more = day.projects.length > 3 ? ` 等 ${day.projects.length} 个项目` : ''
  return `${hovered.value}：${day.total} 次提交（${names}${more}）`
})
</script>

<template>
  <section aria-label="提交活跃度" class="space-y-1.5" data-testid="activity-heatmap">
    <div class="flex items-center gap-2 text-xs">
      <LoaderCircle v-if="loading" :size="12" class="shrink-0 animate-spin text-zinc-400" />
      <p class="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-300" data-testid="activity-summary">
        {{ failure ?? hoveredText ?? `最近一年 ${total.toLocaleString('zh-CN')} 次提交，活跃 ${days.size} 天` }}
      </p>
      <label class="flex shrink-0 cursor-pointer items-center gap-1 text-zinc-500 dark:text-zinc-400">
        <input v-model="mineOnly" type="checkbox" class="accent-teal-600" data-testid="activity-mine" />
        只看我的提交
      </label>
    </div>

    <div class="overflow-x-auto pb-0.5">
      <div class="flex w-max gap-0.5" @mouseleave="hovered = null">
        <div v-for="(week, index) in weeks" :key="week[0]" class="flex w-2.5 flex-col gap-0.5">
          <span class="h-3.5 whitespace-nowrap text-[10px] leading-3 text-zinc-500 dark:text-zinc-400">{{ months[index] }}</span>
          <span
            v-for="day in week"
            :key="day"
            class="h-2.5 w-2.5 rounded-sm"
            :class="LEVELS[levelOf(days.get(day)?.total ?? 0, thresholds)]"
            :aria-label="`${day}：${days.get(day)?.total ?? 0} 次提交`"
            data-testid="activity-cell"
            :data-day="day"
            :data-count="days.get(day)?.total ?? 0"
            @mouseenter="hovered = day"
          />
        </div>
      </div>
    </div>

    <div class="flex items-center justify-end gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
      少
      <span v-for="level in LEVELS" :key="level" class="h-2.5 w-2.5 rounded-sm" :class="level" />
      多
    </div>
  </section>
</template>
