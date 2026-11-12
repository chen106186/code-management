import type { Category, GitStatus, HiddenProject, Project, ProjectStats } from '@shared/types'

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
export type SortKind =
  | 'activity'
  | 'name'
  | 'changes'
  | 'branch'
  | 'remote'
  | 'commit'
  | 'language'
  | 'lines'
  | 'size'
export type ViewMode = 'cards' | 'list'

export const SORTS: { kind: SortKind; label: string }[] = [
  { kind: 'activity', label: '最近活跃' },
  { kind: 'changes', label: '改动最多' },
  { kind: 'name', label: '名称' },
  { kind: 'branch', label: '分支' },
  { kind: 'remote', label: 'Git 地址' },
  { kind: 'commit', label: '最近提交' },
  { kind: 'language', label: '主要语言' },
  { kind: 'lines', label: '代码行数' },
  { kind: 'size', label: '磁盘占用' }
]

export type ColumnId = 'branch' | 'status' | 'remote' | 'commit' | 'language' | 'lines' | 'size' | 'activity'

export interface ListColumn {
  id: ColumnId
  label: string
  sort: SortKind
  /** CSS 列宽 */
  track: string
  /** 窗口太窄时列保留的最小宽度，单位 rem */
  minRem: number
  /** 只有 Git 项目才有内容；相邻的这些列在其他项目上合并显示一条说明 */
  gitOnly?: boolean
  alignRight?: boolean
  /** 默认不显示，在列设置里打开 */
  optional?: boolean
}

export const LIST_COLUMNS: ListColumn[] = [
  { id: 'branch', label: '分支', sort: 'branch', track: '8rem', minRem: 8, gitOnly: true },
  { id: 'status', label: '状态', sort: 'changes', track: '6.5rem', minRem: 6.5, gitOnly: true },
  { id: 'remote', label: 'Git 地址', sort: 'remote', track: 'minmax(0, 2fr)', minRem: 9, gitOnly: true },
  { id: 'commit', label: '最近提交', sort: 'commit', track: 'minmax(0, 1.2fr)', minRem: 5, gitOnly: true },
  { id: 'language', label: '主要语言', sort: 'language', track: '7rem', minRem: 7, optional: true },
  { id: 'lines', label: '代码行数', sort: 'lines', track: '5rem', minRem: 5, alignRight: true, optional: true },
  { id: 'size', label: '磁盘占用', sort: 'size', track: '5rem', minRem: 5, alignRight: true, optional: true },
  { id: 'activity', label: '活跃', sort: 'activity', track: '5rem', minRem: 5, alignRight: true }
]

const DEFAULT_HIDDEN_COLUMNS: ColumnId[] = LIST_COLUMNS.filter((c) => c.optional).map((c) => c.id)

const FIXED_TRACKS = '2rem 1rem 14px 1.25rem minmax(0, 1.2fr)'
/** 序号、选择框、收藏、图标和名称的最小宽度，加上左右内边距 */
const FIXED_MIN_REM = 2 + 1 + 0.875 + 1.25 + 7 + 1.5

/** 表头和每一行共用这组列宽；列之间的间距按 0.625rem 计入最小宽度 */
export function listLayout(columns: ListColumn[]): { template: string; minWidth: string } {
  const gaps = (columns.length + 4) * 0.625
  const minRem = FIXED_MIN_REM + gaps + columns.reduce((sum, column) => sum + column.minRem, 0)
  return {
    template: [FIXED_TRACKS, ...columns.map((column) => column.track)].join(' '),
    minWidth: `${minRem}rem`
  }
}

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
  sortReverse: boolean
  scope: CategoryScope
  activeTag: string | null
  viewMode: ViewMode
  hiddenColumns: ColumnId[]
  showActivity: boolean
}

const FILTER_KINDS: readonly string[] = [...FILTERS, ...STAT_FILTERS].map((f) => f.kind)
const SORT_KINDS: readonly string[] = SORTS.map((s) => s.kind)
const COLUMN_IDS: readonly string[] = LIST_COLUMNS.map((c) => c.id)

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
    sort: SORT_KINDS.includes(raw.sort as string) ? (raw.sort as SortKind) : 'activity',
    sortReverse: raw.sortReverse === true,
    scope: typeof raw.scope === 'string' && raw.scope !== SCOPE_HIDDEN ? raw.scope : SCOPE_ALL,
    activeTag: typeof raw.activeTag === 'string' ? raw.activeTag : null,
    viewMode: raw.viewMode === 'list' ? 'list' : 'cards',
    hiddenColumns: Array.isArray(raw.hiddenColumns)
      ? (raw.hiddenColumns as unknown[]).filter((id): id is ColumnId => COLUMN_IDS.includes(id as string))
      : [...DEFAULT_HIDDEN_COLUMNS],
    showActivity: raw.showActivity === true
  }
}

/** 标签下拉框的选项：手动标签加自动识别的技术栈，只差大小写的算一项，写法以技术栈为准 */
export function tagFilterOptions(projects: Project[]): string[] {
  const options = new Map<string, string>()
  for (const project of projects) {
    for (const tag of project.tags) {
      if (!options.has(tag.toLowerCase())) options.set(tag.toLowerCase(), tag)
    }
  }
  for (const project of projects) {
    for (const tech of project.tech) options.set(tech.toLowerCase(), tech)
  }
  return [...options.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export function matchesTagFilter(project: Project, tag: string | null): boolean {
  if (!tag) return true
  const wanted = tag.toLowerCase()
  return [...project.tags, ...project.tech].some((name) => name.toLowerCase() === wanted)
}

/** 快速跳转：名称开头最优先，其次名称包含，最后是路径、分支等其他字段；同档按最近活跃 */
export function rankProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase()
  const tier = (project: Project): number => {
    const names = [project.remark ?? '', project.name].map((n) => n.toLowerCase())
    if (names.some((n) => n.startsWith(q))) return 0
    return names.some((n) => n.includes(q)) ? 1 : 2
  }
  return projects
    .filter((p) => matchesQuery(p, q))
    .map((project) => ({ project, rank: q ? tier(project) : 0 }))
    .sort((a, b) => a.rank - b.rank || compareProjects(a.project, b.project, 'activity'))
    .map(({ project }) => project)
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

export function mainRemoteUrl(project: Project): string | null {
  const remotes = project.git?.remotes ?? []
  return (remotes.find((remote) => remote.name === 'origin') ?? remotes[0])?.url ?? null
}

/** 排序用的值；没有这项信息时为 null，正序倒序都排在最后 */
function sortValue(project: Project, sort: SortKind): string | number | null {
  switch (sort) {
    case 'activity':
      return project.lastActivity
    case 'name':
      return project.remark ?? project.name
    case 'changes':
      return project.git ? changeCount(project.git) : null
    case 'branch':
      return project.git ? branchLabel(project.git) : null
    case 'remote':
      return mainRemoteUrl(project)
    case 'commit':
      return project.git?.lastCommit?.time ?? null
    case 'language':
      return project.stats?.languages[0]?.name ?? null
    case 'lines':
      return project.stats?.lines ?? null
    case 'size':
      return project.stats?.size ?? null
  }
}

/** 文字默认从 A 到 Z，数字和时间默认从大到小 */
export function sortsDescending(sort: SortKind, reverse: boolean): boolean {
  const textual = sort === 'name' || sort === 'branch' || sort === 'remote' || sort === 'language'
  return textual === reverse
}

/** 收藏始终排在前面；相同时按名称，让顺序稳定 */
export function compareProjects(a: Project, b: Project, sort: SortKind, reverse = false): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
  const byName = (a.remark ?? a.name).localeCompare(b.remark ?? b.name, 'zh-CN')
  const [x, y] = [sortValue(a, sort), sortValue(b, sort)]
  if (x === null || y === null) return x === y ? byName : x === null ? 1 : -1
  const ascending =
    typeof x === 'string' ? x.localeCompare(y as string, 'zh-CN') : x - (y as number)
  return (sortsDescending(sort, reverse) ? -ascending : ascending) || byName
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

export function languageShares(stats: ProjectStats): { name: string; lines: number; percent: number }[] {
  return stats.languages.map(({ name, lines }) => ({
    name,
    lines,
    percent: stats.lines ? Math.round((lines / stats.lines) * 100) : 0
  }))
}

export function statsHint(stats: ProjectStats): string {
  const parts = [`磁盘占用 ${formatBytes(stats.size)}`]
  if (stats.generatedSize) parts.push(`其中依赖和构建产物 ${formatBytes(stats.generatedSize)}`)
  if (stats.lines) parts.push(`代码 ${stats.lines.toLocaleString('zh-CN')} 行`)
  if (stats.truncated) parts.push('项目太大，只统计了一部分')
  return parts.join('，')
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
