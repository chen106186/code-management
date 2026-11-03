import type { Category, GitStatus, Project } from '@shared/types'

/** 左侧选中的范围：全部、未分类，或某个分类的 id */
export type CategoryScope = string
export const SCOPE_ALL = 'all'
export const SCOPE_UNCATEGORIZED = 'uncategorized'

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

export type FilterKind = 'all' | 'changed' | 'unpushed' | 'favorite' | 'nonGit'
export type SortKind = 'activity' | 'name' | 'changes'

export const FILTERS: { kind: FilterKind; label: string }[] = [
  { kind: 'all', label: '全部' },
  { kind: 'changed', label: '有改动' },
  { kind: 'unpushed', label: '未推送' },
  { kind: 'favorite', label: '收藏' },
  { kind: 'nonGit', label: '未用 Git' }
]

export function changeCount(git: GitStatus | null): number {
  if (!git) return 0
  return git.staged + git.unstaged + git.untracked + git.conflicted
}

export function matchesFilter(project: Project, kind: FilterKind): boolean {
  switch (kind) {
    case 'all':
      return true
    case 'changed':
      return changeCount(project.git) > 0
    case 'unpushed':
      return (project.git?.ahead ?? 0) > 0
    case 'favorite':
      return project.favorite
    case 'nonGit':
      return !project.isGit && !project.missing
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
    ...project.tech,
    ...project.tags
  ]
    .join('\n')
    .toLowerCase()
    .includes(q)
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
