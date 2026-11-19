import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Project } from '@shared/types'
import { useProjectsStore } from './projects'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
})

it('批量拉取时跳过非 Git 项目，继续处理失败项并刷新状态', async () => {
  const pullRepo = vi.fn()
    .mockResolvedValueOnce({ ok: false, cancelled: false, message: '没有上游分支' })
    .mockResolvedValueOnce({ ok: true, cancelled: false, message: '' })
  const refresh = vi.fn().mockResolvedValue(null)
  vi.stubGlobal('window', { api: {
    pullRepo,
    refresh,
    onAutoFetched: vi.fn(),
    onStatsUpdated: vi.fn(),
    getAutoFetchStatus: vi.fn().mockResolvedValue({ lastRun: null, succeeded: 0, failed: [] })
  } })
  const store = useProjectsStore()
  store.projects = [
    { path: 'a', name: 'A', isGit: true, missing: false },
    { path: 'b', name: 'B', isGit: false, missing: false },
    { path: 'c', name: 'C', isGit: true, missing: false }
  ] as Project[]

  await store.pullProjects(['a', 'b', 'c'])

  expect(pullRepo.mock.calls.map(([path]) => path)).toEqual(['a', 'c'])
  expect(store.pullSummary).toEqual({ succeeded: 1, skipped: 1, failed: [{ path: 'a', name: 'A', message: '没有上游分支' }] })
  expect(refresh).toHaveBeenCalledOnce()
  expect(store.pulling).toBeNull()
})

it('逐个更新项目拉取状态，完成后使用统一刷新状态', async () => {
  let finishPull!: (value: { ok: boolean; cancelled: boolean; message: string }) => void
  let finishRefresh!: (value: null) => void
  const pullRepo = vi.fn()
    .mockImplementationOnce(() => new Promise((resolve) => { finishPull = resolve }))
    .mockResolvedValueOnce({ ok: true, cancelled: false, message: '' })
  const refresh = vi.fn(() => new Promise<null>((resolve) => { finishRefresh = resolve }))
  vi.stubGlobal('window', { api: {
    pullRepo, refresh, onAutoFetched: vi.fn(), onStatsUpdated: vi.fn(),
    getAutoFetchStatus: vi.fn().mockResolvedValue({ lastRun: null, succeeded: 0, failed: [] })
  } })
  const store = useProjectsStore()
  store.projects = [
    { path: 'a', name: 'A', isGit: true, missing: false },
    { path: 'b', name: 'B', isGit: true, missing: false }
  ] as Project[]

  const pending = store.pullProjects(['a', 'b'])
  expect(store.pulling).toEqual({ paths: ['a', 'b'], current: 'a' })
  finishPull({ ok: true, cancelled: false, message: '' })
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(store.pulling?.paths).toEqual([])
  expect(store.loading).toBe(true)
  finishRefresh(null)
  await pending
  expect(store.loading).toBe(false)
  expect(store.pulling).toBeNull()
})

it('全选与取消全选只影响当前筛选出的项目', () => {
  vi.stubGlobal('window', { api: {
    onAutoFetched: vi.fn(), onStatsUpdated: vi.fn(),
    getAutoFetchStatus: vi.fn().mockResolvedValue({ lastRun: null, succeeded: 0, failed: [] })
  } })
  const store = useProjectsStore()
  const project = (name: string): Project => ({
    path: name, name, missing: false, isGit: false, git: null, gitError: null,
    tech: [], lastActivity: null, favorite: false, tags: [], categoryId: null,
    remark: null, stats: null
  })
  store.projects = [project('alpha'), project('beta')]
  store.selected = new Set(['beta'])
  store.query = 'alpha'

  store.selectAllVisible()
  expect([...store.selected].sort()).toEqual(['alpha', 'beta'])
  store.selectAllVisible()
  expect([...store.selected]).toEqual(['beta'])
})
