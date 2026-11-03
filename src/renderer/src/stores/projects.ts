import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Branch, FetchAllItem } from '@shared/repo'
import { subtreeIds } from '@shared/categories'
import type {
  Category,
  Config,
  HiddenProject,
  Project,
  ProjectMove,
  ProjectPatch,
  ScanError,
  Snapshot,
  ThemeSetting
} from '@shared/types'
import { errorMessage } from '@renderer/lib/errors'
import {
  compareProjects,
  countByCategory,
  FILTERS,
  matchesCategory,
  matchesFilter,
  matchesHiddenQuery,
  matchesQuery,
  parseListPrefs,
  SCOPE_ALL,
  SCOPE_HIDDEN,
  SCOPE_UNCATEGORIZED,
  STAT_FILTERS,
  type CategoryScope,
  type FilterKind,
  type SortKind,
  type ViewMode
} from '@renderer/lib/projectList'

const FOCUS_REFRESH_INTERVAL = 30_000
const COLLAPSED_KEY = 'collapsedCategories'
const LIST_PREFS_KEY = 'listPrefs'

function loadListPrefs(): ReturnType<typeof parseListPrefs> {
  try {
    return parseListPrefs(localStorage.getItem(LIST_PREFS_KEY))
  } catch {
    return parseListPrefs(null)
  }
}

function loadCollapsed(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(saved) ? saved : [])
  } catch {
    return new Set()
  }
}

export interface FetchSummary {
  succeeded: number
  failed: FetchAllItem[]
  cancelled: boolean
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const hiddenProjects = ref<HiddenProject[]>([])
  const moves = ref<ProjectMove[]>([])
  const config = ref<Config>({
    roots: [],
    manual: [],
    hidden: [],
    excluded: [],
    categories: [],
    theme: 'system'
  })
  const scanErrors = ref<ScanError[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetching = ref(false)
  const fetchProgress = ref('')
  const fetchSummary = ref<FetchSummary | null>(null)
  let fetchOpId: string | null = null

  const prefs = loadListPrefs()
  const query = ref('')
  const filter = ref<FilterKind>(prefs.filter)
  const activeTag = ref<string | null>(prefs.activeTag)
  const sort = ref<SortKind>(prefs.sort)
  const viewMode = ref<ViewMode>(prefs.viewMode)

  const scope = ref<CategoryScope>(prefs.scope)
  const collapsed = ref(loadCollapsed())

  watch([filter, sort, scope, activeTag, viewMode], () => {
    try {
      localStorage.setItem(
        LIST_PREFS_KEY,
        JSON.stringify({
          filter: filter.value,
          sort: sort.value,
          scope: scope.value,
          activeTag: activeTag.value,
          viewMode: viewMode.value
        })
      )
    } catch {
      // 只是便利，存不下不影响使用
    }
  })

  const quickJumpOpen = ref(false)

  const categories = computed(() => config.value.categories)
  const categoryCounts = computed(() => countByCategory(categories.value, projects.value))
  const uncategorizedCount = computed(
    () => projects.value.filter((p) => p.categoryId === null).length
  )

  /** 当前左侧范围内的项目，选中父分类时包含子分类 */
  const scopedProjects = computed(() => {
    const ids = subtreeIds(categories.value, scope.value)
    return projects.value.filter((p) => matchesCategory(p, scope.value, ids))
  })

  const visibleHidden = computed(() =>
    hiddenProjects.value.filter((p) => matchesHiddenQuery(p, query.value))
  )

  const allTags = computed(() =>
    [...new Set(projects.value.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  )

  const filterCounts = computed(() =>
    Object.fromEntries(
      [...FILTERS, ...STAT_FILTERS].map(({ kind }) => [
        kind,
        scopedProjects.value.filter((p) => matchesFilter(p, kind)).length
      ])
    )
  )

  const visible = computed(() =>
    scopedProjects.value
      .filter(
        (p) =>
          matchesFilter(p, filter.value) &&
          matchesQuery(p, query.value) &&
          (!activeTag.value || p.tags.includes(activeTag.value))
      )
      .sort((a, b) => compareProjects(a, b, sort.value))
  )

  const selected = ref(new Set<string>())
  /** 只算当前看得到的，避免批量操作碰到被筛选掉的项目 */
  const selectedPaths = computed(() =>
    visible.value.filter((p) => selected.value.has(p.path)).map((p) => p.path)
  )
  let selectAnchor: string | null = null

  /** 按住 Shift 时选中上次点击的项目到这一项之间的全部项目 */
  function toggleSelected(path: string, extend = false): void {
    const next = new Set(selected.value)
    const paths = visible.value.map((p) => p.path)
    const from = selectAnchor === null ? -1 : paths.indexOf(selectAnchor)
    const to = paths.indexOf(path)
    if (extend && from >= 0 && to >= 0) {
      paths.slice(Math.min(from, to), Math.max(from, to) + 1).forEach((p) => next.add(p))
    } else if (!next.delete(path)) {
      next.add(path)
    }
    selectAnchor = path
    selected.value = next
  }

  function selectAllVisible(): void {
    selected.value = new Set(visible.value.map((p) => p.path))
  }

  function clearSelection(): void {
    selected.value = new Set()
    selectAnchor = null
  }

  let requestId = 0
  let lastRefresh = 0

  function checkScope(): void {
    const fixed = [SCOPE_ALL, SCOPE_UNCATEGORIZED, SCOPE_HIDDEN].includes(scope.value)
    if (!fixed && !categories.value.some((c) => c.id === scope.value)) scope.value = SCOPE_ALL
  }

  function apply(snapshot: Snapshot): void {
    projects.value = snapshot.projects
    hiddenProjects.value = snapshot.hiddenProjects
    moves.value = snapshot.moves
    config.value = snapshot.config
    scanErrors.value = snapshot.scanErrors
    if (activeTag.value && !allTags.value.includes(activeTag.value)) activeTag.value = null
    checkScope()
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
      error.value = errorMessage(e)
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
      error.value = errorMessage(e)
    }
  }

  const refresh = (): Promise<void> => run(() => window.api.refresh())

  function applyCategories(next: Category[]): void {
    config.value = { ...config.value, categories: next }
    const ids = new Set(next.map((c) => c.id))
    // 删除分类后，里面的项目在主进程已变成未分类，这里同步，不必重新扫描
    for (const project of projects.value) {
      if (project.categoryId && !ids.has(project.categoryId)) project.categoryId = null
    }
    checkScope()
  }

  /** 创建或重命名：成功返回 true，失败时显示原因并让界面保留输入 */
  async function saveCategory(action: () => Promise<Category[]>): Promise<boolean> {
    try {
      applyCategories(await action())
      error.value = null
      return true
    } catch (e) {
      error.value = errorMessage(e)
      return false
    }
  }

  function toggleCollapsed(id: string): void {
    const next = new Set(collapsed.value)
    if (!next.delete(id)) next.add(id)
    collapsed.value = next
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
    } catch {
      // 折叠状态只是便利，存不下不影响使用
    }
  }

  function expand(id: string): void {
    if (collapsed.value.has(id)) toggleCollapsed(id)
  }

  function refreshIfStale(maxAge = FOCUS_REFRESH_INTERVAL): void {
    if (!loading.value && Date.now() - lastRefresh > maxAge) void refresh()
  }

  async function fetchAll(): Promise<void> {
    const opId = `fetch-all-${Date.now()}`
    fetchOpId = opId
    fetching.value = true
    fetchProgress.value = ''
    fetchSummary.value = null
    const unsubscribe = window.api.onRemoteProgress((progress) => {
      if (progress.opId === opId) fetchProgress.value = progress.line
    })
    try {
      const results = await window.api.fetchAll(opId)
      fetchSummary.value = {
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok && !r.cancelled),
        cancelled: results.some((r) => r.cancelled)
      }
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      unsubscribe()
      fetching.value = false
      fetchOpId = null
    }
    await refresh()
  }

  function cancelFetchAll(): void {
    if (fetchOpId) void window.api.cancelRemote(fetchOpId)
  }

  function find(path: string): Project | undefined {
    return projects.value.find((p) => p.path === path)
  }

  /** 主进程按路径返回修改后的值，这里同步，不必重新扫描 */
  const updateProjects = (paths: string[], patch: ProjectPatch): Promise<void> =>
    guard(async () => {
      const saved = await window.api.updateProjects(paths, patch)
      for (const [path, meta] of Object.entries(saved)) {
        const project = find(path)
        if (project) Object.assign(project, meta)
      }
      if (activeTag.value && !allTags.value.includes(activeTag.value)) activeTag.value = null
    })

  return {
    projects,
    moves,
    viewMode,
    quickJumpOpen,
    selected,
    selectedPaths,
    toggleSelected,
    selectAllVisible,
    clearSelection,
    updateProjects,
    /** 拖动已选中的项目时带上整批，否则只拖这一个 */
    dragPaths: (path: string): string[] =>
      selected.value.has(path) ? selectedPaths.value : [path],
    hideProjects: async (paths: string[]): Promise<void> => {
      await run(() => window.api.hideProjects(paths))
      clearSelection()
    },
    applyMoves: (from: string[]) => run(() => window.api.applyMoves(from)),
    dismissMoves: (from: string[]) => run(() => window.api.dismissMoves(from)),
    /** 返回保存的位置，取消或失败时返回 null */
    exportConfig: async (): Promise<string | null> => {
      try {
        return await window.api.exportConfig()
      } catch (e) {
        error.value = errorMessage(e)
        return null
      }
    },
    /** 成功返回 true */
    importConfig: async (): Promise<boolean> => {
      try {
        const snapshot = await window.api.importConfig()
        if (!snapshot) return false
        apply(snapshot)
        error.value = null
        return true
      } catch (e) {
        error.value = errorMessage(e)
        return false
      }
    },
    config,
    scanErrors,
    loaded,
    loading,
    error,
    fetching,
    fetchProgress,
    fetchSummary,
    fetchAll,
    cancelFetchAll,
    query,
    filter,
    activeTag,
    sort,
    hiddenProjects,
    visibleHidden,
    scope,
    scopedProjects,
    collapsed,
    categories,
    categoryCounts,
    uncategorizedCount,
    toggleCollapsed,
    expand,
    createCategory: (name: string, parentId: string | null) =>
      saveCategory(() => window.api.createCategory(name, parentId)),
    renameCategory: (id: string, name: string) =>
      saveCategory(() => window.api.renameCategory(id, name)),
    moveCategory: (id: string, parentId: string | null, beforeId: string | null) =>
      saveCategory(() => window.api.moveCategory(id, parentId, beforeId)),
    deleteCategory: (id: string) =>
      guard(async () => {
        const next = await window.api.deleteCategory(id)
        if (next) applyCategories(next)
      }),
    setProjectCategory: (path: string, categoryId: string | null) =>
      guard(async () => {
        await window.api.setProjectCategory(path, categoryId)
        const project = find(path)
        if (project) project.categoryId = categoryId
      }),
    /** 不论成败都读一次状态：失败时分支没变，成功时只更新这一张卡片，不必重新扫描 */
    switchBranch: async (path: string, branch: Branch): Promise<void> => {
      try {
        await window.api.switchBranch(path, branch.name, branch.kind)
        error.value = null
      } catch (e) {
        error.value = errorMessage(e)
      }
      await guard(async () => {
        const { status } = await window.api.getChanges(path)
        const project = find(path)
        if (project) project.git = status
      })
    },
    setRemark: (path: string, remark: string) =>
      guard(async () => {
        const saved = await window.api.setRemark(path, remark)
        const project = find(path)
        if (project) project.remark = saved
      }),
    setTheme: (theme: ThemeSetting) =>
      guard(async () => {
        await window.api.setTheme(theme)
        config.value = { ...config.value, theme }
      }),
    allTags,
    filterCounts,
    visible,
    refresh,
    refreshIfStale,
    addRoot: () => run(() => window.api.addRoot()),
    addProject: () => run(() => window.api.addProject()),
    addExcluded: () => run(() => window.api.addExcluded()),
    removeRoot: (path: string) => run(() => window.api.removeRoot(path)),
    removeExcluded: (path: string) => run(() => window.api.removeExcluded(path)),
    hideProject: (path: string) => run(() => window.api.hideProject(path)),
    restoreProject: (path: string) => run(() => window.api.restoreProject(path)),
    openInEditor: (path: string) => guard(() => window.api.openInEditor(path)),
    openInTerminal: (path: string) => guard(() => window.api.openInTerminal(path)),
    openInExplorer: (path: string) => guard(() => window.api.openInExplorer(path)),
    openRemote: (path: string, remoteName: string) =>
      guard(() => window.api.openRemote(path, remoteName)),
    /** 成功返回 true，让界面给出已复制的反馈 */
    copyText: async (text: string): Promise<boolean> => {
      try {
        await window.api.copyText(text)
        return true
      } catch (e) {
        error.value = errorMessage(e)
        return false
      }
    },
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
