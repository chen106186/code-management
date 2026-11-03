import type { Category, GitStatus, HiddenProject, Project } from '@shared/types'

/** 左侧选中的范围：全部、未分类，或某个分类的 id */
export type CategoryScope = string
export const SCOPE_ALL = 'all'
export const SCOPE_UNCATEGORIZED = 'uncategorized'
export const SCOPE_HIDDEN = 'hidden'

export function matchesCategory(
  project: Project,
  scope: CategoryScope,
  scopeIds: ReadonlySet<string>
): boolean {
  if (scope === SCOPE_ALL) return true
  if (scope === SCOPE_UNCATEGORIZED) return project.categoryId === null
  return project.categoryId !== null && scopeIds.has(project.categoryId)
}

/** 每个分类的项目数，子分类的项目也计入各级父分类 */
export function countByCategory(categories: Category[], projects: Project[]): Map<string, number> {
  const parents = new Map(categories.map((c) => [c.id, c.parentId]))
  const counts = new Map<string, number>()
  for (const project of projects) {
    const seen = new Set<string>()
    let current = project.categoryId
    while (current && !seen.has(current)) {
      seen.add(current)
      counts.set(current, (counts.get(current) ?? 0) + 1)
      current = parents.get(current) ?? null
    }
  }
  return counts
}

export type FilterKind = 'all' | 'changed' | 'unpushed' | 'behind' | 'stale' | 'favorite' | 'nonGit'
export type SortKind = 'activity' | 'name' | 'changes'
export type ViewMode = 'cards' | 'list'

export const FILTERS: { kind: FilterKind; label: string }[] = [
  { kind: 'all', label: '全部' },
  { kind: 'favorite', label: '收藏' },
  { kind: 'nonGit', label: '未用 Git' }
]

/** 看板统计里的几项，点击后同样按它筛选 */
export const STAT_FILTERS: { kind: FilterKind; label: string; hint: string }[] = [
  { kind: 'changed', label: '有改动', hint: '工作区有未提交的改动' },
  { kind: 'unpushed', label: '未推送', hint: '本地有提交还没推送到上游' },
  { kind: 'behind', label: '落后远程', hint: '上游有新提交，取决于最近一次 Fetch' },
  { kind: 'stale', label: '长期不活跃', hint: '超过 90 天没有提交，也没有修改文件' }
]

export const STALE_MS = 90 * 86_400_000

export function changeCount(git: GitStatus | null): number {
  if (!git) return 0
  return git.staged + git.unstaged + git.untracked + git.conflicted
}

export function branchLabel(git: GitStatus | null): string {
  if (!git) return ''
  return git.branch ?? `游离 ${git.head?.slice(0, 7) ?? ''}`
}

export function matchesFilter(project: Project, kind: FilterKind, now = Date.now()): boolean {
  switch (kind) {
    case 'all':
      return true
    case 'changed':
      return changeCount(project.git) > 0
    case 'unpushed':
      return (project.git?.ahead ?? 0) > 0
    case 'behind':
      return (project.git?.behind ?? 0) > 0
    case 'stale':
      return !project.missing && project.lastActivity !== null && now - project.lastActivity > STALE_MS
    case 'favorite':
      return project.favorite
    case 'nonGit':
      return !project.isGit && !project.missing
  }
}

export interface ListPrefs {
  filter: FilterKind
  sort: SortKind
  scope: CategoryScope
  activeTag: string | null
  viewMode: ViewMode
}

const FILTER_KINDS: readonly string[] = [...FILTERS, ...STAT_FILTERS].map((f) => f.kind)

/** 已保存的值可能来自旧版本，无效的项退回默认；已隐藏只是临时查看，不恢复 */
export function parseListPrefs(text: string | null): ListPrefs {
  let raw: Partial<Record<keyof ListPrefs, unknown>> = {}
  try {
    raw = JSON.parse(text ?? '{}') ?? {}
  } catch {
    // 用默认值
  }
  return {
    filter: FILTER_KINDS.includes(raw.filter as string) ? (raw.filter as FilterKind) : 'all',
    sort: raw.sort === 'name' || raw.sort === 'changes' ? raw.sort : 'activity',
    scope: typeof raw.scope === 'string' && raw.scope !== SCOPE_HIDDEN ? raw.scope : SCOPE_ALL,
    activeTag: typeof raw.activeTag === 'string' ? raw.activeTag : null,
    viewMode: raw.viewMode === 'list' ? 'list' : 'cards'
  }
}

export function matchesQuery(project: Project, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [
    project.name,
    project.remark ?? '',
    project.path,
    project.git?.branch ?? '',
    ...(project.git?.remotes.map((r) => r.url) ?? []),
    ...project.tech,
    ...project.tags
  ]
    .join('\n')
    .toLowerCase()
    .includes(q)
}

export function matchesHiddenQuery(project: HiddenProject, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [project.name, project.remark ?? '', project.path].join('\n').toLowerCase().includes(q)
}

/** 收藏始终排在前面 */
export function compareProjects(a: Project, b: Project, sort: SortKind): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
  const byName = (a.remark ?? a.name).localeCompare(b.remark ?? b.name, 'zh-CN')
  switch (sort) {
    case 'activity':
      return (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || byName
    case 'changes':
      return changeCount(b.git) - changeCount(a.git) || byName
    case 'name':
      return byName
  }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000]
]

const relative = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

export function formatRelative(time: number, now = Date.now()): string {
  const diff = now - time
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return relative.format(-Math.floor(diff / ms), unit)
  }
  return '刚刚'
}
