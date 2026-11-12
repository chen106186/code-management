import { describe, expect, it } from 'vitest'
import type { GitStatus, Project, ProjectStats } from '@shared/types'
import {
  compareProjects,
  countByCategory,
  formatBytes,
  formatRelative,
  languageShares,
  LIST_COLUMNS,
  listLayout,
  mainRemoteUrl,
  matchesCategory,
  matchesFilter,
  matchesHiddenQuery,
  matchesQuery,
  matchesTagFilter,
  parseListPrefs,
  rankProjects,
  SCOPE_ALL,
  SCOPE_HIDDEN,
  sortsDescending,
  STALE_MS,
  statsHint,
  tagFilterOptions,
  type SortKind
} from './projectList'

const git = (overrides: Partial<GitStatus> = {}): GitStatus => ({
  branch: 'main',
  head: 'abc',
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  stashCount: 0,
  lastCommit: null,
  remotes: [],
  ...overrides
})

const project = (overrides: Partial<Project> = {}): Project => ({
  path: 'E:\\code\\app',
  name: 'app',
  missing: false,
  isGit: true,
  git: git(),
  gitError: null,
  tech: ['Vue'],
  lastActivity: 0,
  favorite: false,
  tags: [],
  categoryId: null,
  remark: null,
  stats: null,
  ...overrides
})

describe('按列排序', () => {
  const stats = (size: number, lines = 0, language?: string): ProjectStats => ({
    size,
    generatedSize: 0,
    lines,
    languages: language ? [{ name: language, lines }] : [],
    truncated: false,
    computedAt: 0
  })
  const order = (items: Project[], sort: SortKind, reverse = false): string[] =>
    [...items].sort((a, b) => compareProjects(a, b, sort, reverse)).map((p) => p.name)

  it('文字默认正序，数字默认从大到小，反向后都翻转', () => {
    const items = [project({ name: 'b', stats: stats(1) }), project({ name: 'a', stats: stats(2) })]
    expect(order(items, 'name')).toEqual(['a', 'b'])
    expect(order(items, 'name', true)).toEqual(['b', 'a'])
    expect(order(items, 'size')).toEqual(['a', 'b'])
    expect(order(items, 'size', true)).toEqual(['b', 'a'])
    expect(sortsDescending('name', false)).toBe(false)
    expect(sortsDescending('size', false)).toBe(true)
    expect(sortsDescending('size', true)).toBe(false)
  })

  it('没有值的项目正序倒序都排在最后', () => {
    const items = [project({ name: 'none' }), project({ name: 'one', stats: stats(1) }), project({ name: 'two', stats: stats(2) })]
    expect(order(items, 'size')).toEqual(['two', 'one', 'none'])
    expect(order(items, 'size', true)).toEqual(['one', 'two', 'none'])
    const noGit = project({ name: 'folder', git: null })
    expect(order([noGit, project({ name: 'repo' })], 'branch')).toEqual(['repo', 'folder'])
  })

  it('收藏仍然排在前面，相同值按名称', () => {
    const items = [project({ name: 'c' }), project({ name: 'b' }), project({ name: 'a', favorite: true, git: null })]
    expect(order(items, 'changes')).toEqual(['a', 'b', 'c'])
    expect(order(items, 'changes', true)).toEqual(['a', 'b', 'c'])
  })

  it('Git 地址优先用 origin，语言用行数最多的', () => {
    const remotes = [{ name: 'a', url: 'z' }, { name: 'origin', url: 'y' }]
    expect(mainRemoteUrl(project({ git: git({ remotes }) }))).toBe('y')
    expect(mainRemoteUrl(project())).toBeNull()
    const items = [project({ name: 'x', stats: stats(1, 1, 'Vue') }), project({ name: 'y', stats: stats(1, 1, 'C') })]
    expect(order(items, 'language')).toEqual(['y', 'x'])
  })
})

describe('标签筛选', () => {
  const items = [
    project({ name: 'a', tech: ['Java'], tags: ['后台'] }),
    project({ name: 'b', tech: ['Vue', 'Vite'], tags: [] }),
    project({ name: 'c', tech: [], tags: ['vue'] })
  ]

  it('选项包含手动标签和技术栈，只差大小写的合并', () => {
    expect(tagFilterOptions(items)).toEqual(['后台', 'Java', 'Vite', 'Vue'])
    expect(tagFilterOptions([])).toEqual([])
  })

  it('选中后手动标签和技术栈都能匹配，不区分大小写', () => {
    expect(items.filter((p) => matchesTagFilter(p, 'Vue')).map((p) => p.name)).toEqual(['b', 'c'])
    expect(items.filter((p) => matchesTagFilter(p, 'Java')).map((p) => p.name)).toEqual(['a'])
    expect(items.filter((p) => matchesTagFilter(p, '后台')).map((p) => p.name)).toEqual(['a'])
    expect(items.filter((p) => matchesTagFilter(p, null))).toHaveLength(3)
  })
})

describe('列表的列', () => {
  it('列宽和最小宽度跟随显示的列', () => {
    const all = listLayout(LIST_COLUMNS)
    const few = listLayout(LIST_COLUMNS.filter((c) => c.id === 'activity'))
    expect(few.template.split(' ').pop()).toBe('5rem')
    expect(all.template).toContain('8rem')
    expect(parseFloat(all.minWidth)).toBeGreaterThan(parseFloat(few.minWidth))
  })

  it('默认隐藏可选列，保存的值里无效的列被丢弃', () => {
    expect(parseListPrefs(null).hiddenColumns).toEqual(['language', 'lines', 'size'])
    expect(parseListPrefs(JSON.stringify({ hiddenColumns: ['commit', '旧列', 1] })).hiddenColumns).toEqual(['commit'])
    expect(parseListPrefs(JSON.stringify({ hiddenColumns: [] })).hiddenColumns).toEqual([])
  })
})

describe('格式化', () => {
  it('磁盘占用', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(150 * 1024 * 1024)).toBe('150 MB')
  })

  it('语言占比和说明', () => {
    const stats: ProjectStats = {
      size: 2048,
      generatedSize: 1024,
      lines: 4,
      languages: [{ name: 'Vue', lines: 3 }, { name: 'C', lines: 1 }],
      truncated: true,
      computedAt: 0
    }
    expect(languageShares(stats).map((l) => l.percent)).toEqual([75, 25])
    expect(statsHint(stats)).toBe('磁盘占用 2.0 KB，其中依赖和构建产物 1.0 KB，代码 4 行，项目太大，只统计了一部分')
  })
})

describe('看板统计的筛选', () => {
  it('落后远程看 behind', () => {
    expect(matchesFilter(project(), 'behind')).toBe(false)
    expect(matchesFilter(project({ git: git({ behind: 2 }) }), 'behind')).toBe(true)
  })

  it('长期不活跃：超过 90 天，没有时间或路径不存在的不算', () => {
    const now = STALE_MS * 2
    expect(matchesFilter(project({ lastActivity: now - STALE_MS - 1 }), 'stale', now)).toBe(true)
    expect(matchesFilter(project({ lastActivity: now - STALE_MS }), 'stale', now)).toBe(false)
    expect(matchesFilter(project({ lastActivity: null }), 'stale', now)).toBe(false)
    expect(matchesFilter(project({ lastActivity: 0, missing: true }), 'stale', now)).toBe(false)
  })
})

describe('parseListPrefs', () => {
  it('读取有效值', () => {
    const prefs = {
      filter: 'behind',
      sort: 'name',
      sortReverse: true,
      scope: 'c1',
      activeTag: 't',
      viewMode: 'list',
      hiddenColumns: ['commit'],
      showActivity: true
    }
    expect(parseListPrefs(JSON.stringify(prefs))).toEqual(prefs)
  })

  it('损坏或无效的值退回默认，已隐藏不恢复', () => {
    const defaults = {
      filter: 'all',
      sort: 'activity',
      sortReverse: false,
      scope: SCOPE_ALL,
      activeTag: null,
      viewMode: 'cards',
      hiddenColumns: ['language', 'lines', 'size'],
      showActivity: false
    }
    expect(parseListPrefs(null)).toEqual(defaults)
    expect(parseListPrefs('不是 JSON')).toEqual(defaults)
    expect(parseListPrefs('null')).toEqual(defaults)
    expect(
      parseListPrefs(JSON.stringify({ filter: '旧', sort: 1, scope: SCOPE_HIDDEN, activeTag: 2, viewMode: 'x' }))
    ).toEqual(defaults)
  })
})

describe('rankProjects', () => {
  const names = (list: Project[]): string[] => list.map((p) => p.name)

  it('名称开头优先于包含，再优先于其他字段，备注也算名称', () => {
    const list = [
      project({ name: 'other', path: 'E:\\web\\other' }),
      project({ name: 'my-web', path: 'E:\\my-web' }),
      project({ name: 'web-app', path: 'E:\\web-app', lastActivity: 2 }),
      project({ name: 'x', remark: 'Web 后台', path: 'E:\\x', lastActivity: 1 }),
      project({ name: 'none', path: 'E:\\none' })
    ]
    expect(names(rankProjects(list, 'web'))).toEqual(['web-app', 'x', 'my-web', 'other'])
  })

  it('没有输入时收藏在前，其余按最近活跃', () => {
    const list = [
      project({ name: 'old', lastActivity: 1 }),
      project({ name: 'new', lastActivity: 2 }),
      project({ name: 'star', lastActivity: 0, favorite: true })
    ]
    expect(names(rankProjects(list, ' '))).toEqual(['star', 'new', 'old'])
  })
})

describe('matchesFilter', () => {
  it('有改动包含未跟踪和冲突', () => {
    expect(matchesFilter(project(), 'changed')).toBe(false)
    expect(matchesFilter(project({ git: git({ untracked: 1 }) }), 'changed')).toBe(true)
    expect(matchesFilter(project({ git: git({ conflicted: 1 }) }), 'changed')).toBe(true)
  })

  it('未用 Git 不包含已失效路径', () => {
    expect(matchesFilter(project({ isGit: false, git: null }), 'nonGit')).toBe(true)
    expect(matchesFilter(project({ isGit: false, git: null, missing: true }), 'nonGit')).toBe(false)
  })
})

describe('matchesQuery', () => {
  it('匹配名称、路径、技术栈、标签和分支，不区分大小写', () => {
    const p = project({ tags: ['工作'], git: git({ branch: 'feature/x' }) })
    for (const q of ['APP', 'code', 'vue', '工作', 'feature', '  ']) {
      expect(matchesQuery(p, q)).toBe(true)
    }
    expect(matchesQuery(p, '不存在')).toBe(false)
  })
})

describe('备注', () => {
  it('可以按备注搜索', () => {
    expect(matchesQuery(project({ remark: 'AI 玩具后端' }), '玩具')).toBe(true)
    expect(matchesQuery(project(), '玩具')).toBe(false)
  })

  it('按名称排序时优先用备注', () => {
    const list = [
      project({ name: 'aaa', remark: 'zzz' }),
      project({ name: 'mmm' })
    ]
    list.sort((a, b) => compareProjects(a, b, 'name'))
    expect(list.map((p) => p.name)).toEqual(['mmm', 'aaa'])
  })
})

describe('compareProjects', () => {
  it('收藏优先，其次按最近活跃', () => {
    const list = [
      project({ name: 'old', lastActivity: 1 }),
      project({ name: 'new', lastActivity: 2 }),
      project({ name: 'fav', lastActivity: 0, favorite: true })
    ]
    list.sort((a, b) => compareProjects(a, b, 'activity'))
    expect(list.map((p) => p.name)).toEqual(['fav', 'new', 'old'])
  })

  it('没有活跃时间的项目排在最后', () => {
    const list = [project({ name: 'none', lastActivity: null }), project({ name: 'has', lastActivity: 5 })]
    list.sort((a, b) => compareProjects(a, b, 'activity'))
    expect(list[0].name).toBe('has')
  })
})

describe('远程地址', () => {
  it('可以按地址搜索', () => {
    const p = project({ git: git({ remotes: [{ name: 'origin', url: 'git@gitee.com:team/shop.git' }] }) })
    expect(matchesQuery(p, 'gitee')).toBe(true)
    expect(matchesQuery(project(), 'gitee')).toBe(false)
  })
})

describe('已隐藏', () => {
  it('普通项目不属于已隐藏范围', () => {
    expect(matchesCategory(project(), SCOPE_HIDDEN, new Set([SCOPE_HIDDEN]))).toBe(false)
  })

  it('可以按名称、备注和路径搜索', () => {
    const hidden = { path: 'E:\\code\\app', name: 'app', remark: '官网后台' }
    for (const q of ['APP', '官网', 'code', ' ']) expect(matchesHiddenQuery(hidden, q)).toBe(true)
    expect(matchesHiddenQuery(hidden, '不存在')).toBe(false)
  })
})

describe('分类筛选', () => {
  const categories = [
    { id: 'a', name: 'A', parentId: null },
    { id: 'a1', name: 'A1', parentId: 'a' },
    { id: 'b', name: 'B', parentId: null }
  ]

  it('选中父分类时包含子分类的项目，未分类只含未归类的', () => {
    const inChild = project({ categoryId: 'a1' })
    const none = project()
    const a = new Set(['a', 'a1'])
    expect(matchesCategory(inChild, 'all', a)).toBe(true)
    expect(matchesCategory(none, 'all', a)).toBe(true)
    expect(matchesCategory(inChild, 'a', a)).toBe(true)
    expect(matchesCategory(none, 'a', a)).toBe(false)
    expect(matchesCategory(inChild, 'b', new Set(['b']))).toBe(false)
    expect(matchesCategory(none, 'uncategorized', a)).toBe(true)
    expect(matchesCategory(inChild, 'uncategorized', a)).toBe(false)
  })

  it('计数把子分类的项目算进每一级父分类', () => {
    const counts = countByCategory(categories, [
      project({ categoryId: 'a1' }),
      project({ categoryId: 'a' }),
      project({ categoryId: 'b' }),
      project()
    ])
    expect(counts.get('a')).toBe(2)
    expect(counts.get('a1')).toBe(1)
    expect(counts.get('b')).toBe(1)
  })
})

describe('formatRelative', () => {
  const now = 1_700_000_000_000
  it('按最大单位显示', () => {
    expect(formatRelative(now - 10_000, now)).toBe('刚刚')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5分钟前')
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe('3天前')
  })
})
