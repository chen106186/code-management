import { describe, expect, it } from 'vitest'
import type { GitStatus, Project } from '@shared/types'
import {
  compareProjects,
  countByCategory,
  formatRelative,
  matchesCategory,
  matchesFilter,
  matchesHiddenQuery,
  matchesQuery,
  SCOPE_HIDDEN
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
  lastCommit: null,
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
  ...overrides
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
