import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Config, Project, ScanError, Snapshot } from '@shared/types'
import {
  compareProjects,
  FILTERS,
  matchesFilter,
  matchesQuery,
  type FilterKind,
  type SortKind
} from '@renderer/lib/projectList'

const FOCUS_REFRESH_INTERVAL = 30_000

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const config = ref<Config>({ roots: [], manual: [], hidden: [], excluded: [] })
  const scanErrors = ref<ScanError[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const query = ref('')
  const filter = ref<FilterKind>('all')
  const activeTag = ref<string | null>(null)
  const sort = ref<SortKind>('activity')

  const allTags = computed(() =>
    [...new Set(projects.value.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  )

  const filterCounts = computed(() =>
    Object.fromEntries(
      FILTERS.map(({ kind }) => [kind, projects.value.filter((p) => matchesFilter(p, kind)).length])
    )
  )

  const visible = computed(() =>
    projects.value
      .filter(
        (p) =>
          matchesFilter(p, filter.value) &&
          matchesQuery(p, query.value) &&
          (!activeTag.value || p.tags.includes(activeTag.value))
      )
      .sort((a, b) => compareProjects(a, b, sort.value))
  )

  let requestId = 0
  let lastRefresh = 0

  function apply(snapshot: Snapshot): void {
    projects.value = snapshot.projects
    config.value = snapshot.config
    scanErrors.value = snapshot.scanErrors
    if (activeTag.value && !allTags.value.includes(activeTag.value)) activeTag.value = null
  }

  /** 执行返回快照的操作；较早发起的请求晚于新请求返回时丢弃，避免旧数据覆盖新数据 */
  async function run(action: () => Promise<Snapshot | null>): Promise<void> {
    const id = ++requestId
    loading.value = true
    try {
      const snapshot = await action()
      if (snapshot && id === requestId) {
        apply(snapshot)
        lastRefresh = Date.now()
      }
      error.value = null
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      if (id === requestId) {
        loading.value = false
        loaded.value = true
      }
    }
  }

  async function guard(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  const refresh = (): Promise<void> => run(() => window.api.refresh())

  function refreshOnFocus(): void {
    if (!loading.value && Date.now() - lastRefresh > FOCUS_REFRESH_INTERVAL) void refresh()
  }

  function find(path: string): Project | undefined {
    return projects.value.find((p) => p.path === path)
  }

  return {
    projects,
    config,
    scanErrors,
    loaded,
    loading,
    error,
    query,
    filter,
    activeTag,
    sort,
    allTags,
    filterCounts,
    visible,
    refresh,
    refreshOnFocus,
    addRoot: () => run(() => window.api.addRoot()),
    addProject: () => run(() => window.api.addProject()),
    addExcluded: () => run(() => window.api.addExcluded()),
    initGit: (path: string) => run(() => window.api.initGit(path)),
    removeRoot: (path: string) => run(() => window.api.removeRoot(path)),
    removeExcluded: (path: string) => run(() => window.api.removeExcluded(path)),
    hideProject: (path: string) => run(() => window.api.hideProject(path)),
    restoreProject: (path: string) => run(() => window.api.restoreProject(path)),
    openInEditor: (path: string) => guard(() => window.api.openInEditor(path)),
    openInTerminal: (path: string) => guard(() => window.api.openInTerminal(path)),
    openInExplorer: (path: string) => guard(() => window.api.openInExplorer(path)),
    toggleFavorite: (path: string) =>
      guard(async () => {
        const project = find(path)
        if (!project) return
        await window.api.setFavorite(path, !project.favorite)
        project.favorite = !project.favorite
      }),
    setTags: (path: string, tags: string[]) =>
      guard(async () => {
        const saved = await window.api.setTags(path, tags)
        const project = find(path)
        if (project) project.tags = saved
        if (activeTag.value && !allTags.value.includes(activeTag.value)) activeTag.value = null
      })
  }
})
