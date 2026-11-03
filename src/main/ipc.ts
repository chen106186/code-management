import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  API_METHODS,
  channelOf,
  EVENT_REMOTE_PROGRESS,
  EVENT_REPO_CHANGED,
  type Api
} from '@shared/ipc'
import { subtreeIds } from '@shared/categories'
import { remoteWebUrl } from '@shared/remotes'
import type { DiffTarget, FetchAllItem } from '@shared/repo'
import { readChanges, readRemotes } from './services/git'
import {
  assertHash,
  assertRepoPath,
  listBranches,
  listRemotes,
  readCommit,
  readDiff,
  readLog,
  switchBranch
} from './services/gitOps'
import { openInEditor, openInExplorer, openInTerminal } from './services/openers'
import { mapLimit, type ProjectService } from './services/projects'
import { runFetch } from './services/remoteOps'
import { RepoQueue } from './services/repoQueue'
import { RepoWatcher } from './services/repoWatcher'
import { isThemeSetting, parseExport, type Store } from './services/store'

const FETCH_ALL_CONCURRENCY = 4
const FETCH_ALL_TIMEOUT_MS = 60_000
const MAX_LOG_PAGE = 500

async function pickDirectory(
  window: BrowserWindow,
  title: string,
  defaultPath?: string
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title,
    defaultPath,
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
}

export function registerIpc(
  store: Store,
  projects: ProjectService,
  getWindow: () => BrowserWindow
): void {
  /** 渲染进程传来的路径必须是已登记的项目或目录，否则拒绝 */
  const known = (path: unknown): string => {
    if (typeof path !== 'string' || !projects.isKnown(path)) {
      throw new Error('未登记的项目路径')
    }
    return path
  }

  const categoryRef = (id: unknown): string | null => {
    if (id === null) return null
    if (typeof id !== 'string') throw new Error('分类无效')
    return id
  }

  const stringList = (values: unknown): string[] => {
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
      throw new Error('路径无效')
    }
    return values
  }

  const diffTarget = (repo: string, target: DiffTarget): DiffTarget => {
    const path = assertRepoPath(repo, target?.path)
    const origPath = target.origPath === null ? null : assertRepoPath(repo, target.origPath)
    if (target.kind === 'commit') {
      const parent = target.parent === null ? null : assertHash(target.parent)
      return { kind: 'commit', hash: assertHash(target.hash), parent, path, origPath }
    }
    if (target.kind !== 'staged' && target.kind !== 'unstaged') throw new Error('Diff 类型无效')
    return { kind: target.kind, path, origPath }
  }

  const send = (channel: string, payload: unknown): void => {
    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }

  const queue = new RepoQueue()
  const operations = new Map<string, AbortController>()
  const watcher = new RepoWatcher((path) => send(EVENT_REPO_CHANGED, path))

  const beginOperation = (opId: unknown): AbortController => {
    if (typeof opId !== 'string' || !opId) throw new Error('操作标识无效')
    const controller = new AbortController()
    operations.set(opId, controller)
    return controller
  }

  const handlers: Api = {
    refresh: () => projects.snapshot(),

    addRoot: async () => {
      const path = await pickDirectory(getWindow(), '选择要扫描的根目录')
      if (!path) return null
      store.addRoot(path)
      return projects.snapshot()
    },

    addProject: async () => {
      const path = await pickDirectory(getWindow(), '选择项目文件夹')
      if (!path) return null
      store.addManual(path)
      return projects.snapshot()
    },

    addExcluded: async () => {
      const path = await pickDirectory(getWindow(), '选择要排除的目录', store.config.roots[0])
      if (!path) return null
      store.addExcluded(path)
      return projects.snapshot()
    },

    removeRoot: async (path) => {
      if (typeof path !== 'string') throw new Error('路径无效')
      store.removeRoot(path)
      return projects.snapshot()
    },

    removeExcluded: async (path) => {
      if (typeof path !== 'string') throw new Error('路径无效')
      store.removeExcluded(path)
      return projects.snapshot()
    },

    hideProject: async (path) => {
      store.hide(known(path))
      return projects.snapshot()
    },

    restoreProject: async (path) => {
      store.restore(known(path))
      return projects.snapshot()
    },

    setFavorite: async (path, favorite) => {
      store.setFavorite(known(path), favorite === true)
    },

    setTags: async (path, tags) => {
      if (!Array.isArray(tags) || !tags.every((t) => typeof t === 'string')) {
        throw new Error('标签无效')
      }
      return store.setTags(known(path), tags)
    },

    setRemark: async (path, remark) => {
      if (typeof remark !== 'string') throw new Error('备注无效')
      return store.setRemark(known(path), remark)
    },

    createCategory: async (name, parentId) => {
      store.createCategory(name, categoryRef(parentId))
      return store.categories
    },

    renameCategory: async (id, name) => {
      store.renameCategory(String(id), name)
      return store.categories
    },

    moveCategory: async (id, parentId, beforeId) => {
      store.moveCategory(String(id), categoryRef(parentId), categoryRef(beforeId))
      return store.categories
    },

    deleteCategory: async (id) => {
      const categories = store.categories
      const category = categories.find((c) => c.id === id)
      if (!category) throw new Error('分类不存在')
      const childCount = subtreeIds(categories, category.id).size - 1
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: 'warning',
        title: '删除分类',
        message: `删除分类“${category.name}”？`,
        detail: `${childCount ? `其下 ${childCount} 个子分类也会一起删除。` : ''}只删除分类，其中的项目会变成未分类，文件不受影响。`,
        buttons: ['删除', '取消'],
        defaultId: 1,
        cancelId: 1
      })
      if (response !== 0) return null
      store.deleteCategory(category.id)
      return store.categories
    },

    setProjectCategory: async (path, categoryId) => {
      store.setCategory(known(path), categoryRef(categoryId))
    },

    applyMoves: async (from) => {
      store.migrateProjects(projects.suggestedMoves(stringList(from)))
      return projects.snapshot()
    },

    dismissMoves: async (from) => {
      store.ignoreMoves(projects.suggestedMoves(stringList(from)).map((move) => move.from))
      return projects.snapshot()
    },

    exportConfig: async () => {
      const date = new Date().toISOString().slice(0, 10)
      const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
        title: '导出配置',
        defaultPath: join(store.directory, `项目代码看板配置-${date}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (canceled || !filePath) return null
      await writeFile(filePath, JSON.stringify(store.exportData(), null, 2), 'utf8')
      return filePath
    },

    importConfig: async () => {
      const window = getWindow()
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: '导入配置',
        defaultPath: store.directory,
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (canceled || !filePaths[0]) return null
      const data = parseExport(await readFile(filePaths[0], 'utf8'))
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '导入配置',
        message: '用这个文件替换当前全部配置？',
        detail: `文件包含 ${data.roots.length} 个根目录、${data.categories.length} 个分类、${Object.keys(data.meta).length} 个项目的信息。当前配置会先备份到数据目录，项目文件不受影响。`,
        buttons: ['替换', '取消'],
        defaultId: 1,
        cancelId: 1
      })
      if (response !== 0) return null
      store.replaceData(data)
      nativeTheme.themeSource = store.theme
      return projects.snapshot()
    },

    // 页面样式和 Monaco 都跟随 prefers-color-scheme，改 themeSource 后会一起切换
    setTheme: async (theme) => {
      if (!isThemeSetting(theme)) throw new Error('主题无效')
      store.setTheme(theme)
      nativeTheme.themeSource = theme
    },

    openInEditor: (path) => openInEditor(known(path)),
    openInTerminal: (path) => openInTerminal(known(path)),
    openInExplorer: (path) => openInExplorer(known(path)),

    openRemote: async (path, remoteName) => {
      const remote = (await readRemotes(known(path))).find((r) => r.name === remoteName)
      const url = remote && remoteWebUrl(remote.url)
      if (!url) throw new Error('这个地址不能在浏览器打开')
      await shell.openExternal(url)
    },

    copyText: async (text) => {
      if (typeof text !== 'string') throw new Error('内容无效')
      clipboard.writeText(text)
    },

    getChanges: async (path) => readChanges(known(path)),

    getDiff: async (path, target) => {
      const repo = known(path)
      return readDiff(repo, diffTarget(repo, target))
    },

    getLog: async (path, skip, limit) => {
      const repo = known(path)
      const validSkip = Number.isInteger(skip) && skip >= 0 ? skip : 0
      const validLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LOG_PAGE) : 100
      return readLog(repo, validSkip, validLimit)
    },

    getCommit: async (path, hash) => readCommit(known(path), assertHash(hash)),

    getBranches: async (path) => listBranches(known(path)),

    switchBranch: async (path, name, kind) => {
      const repo = known(path)
      await queue.run(repo, () => switchBranch(repo, name, kind === 'remote' ? 'remote' : 'local'))
    },

    fetchRepo: async (path, opId) => {
      const repo = known(path)
      const controller = beginOperation(opId)
      try {
        return await queue.run(repo, () =>
          runFetch(repo, {
            signal: controller.signal,
            onProgress: (line) => send(EVENT_REMOTE_PROGRESS, { opId, line })
          })
        )
      } finally {
        operations.delete(opId)
      }
    },

    fetchAll: async (opId) => {
      const controller = beginOperation(opId)
      try {
        const { projects: list } = await projects.snapshot()
        const repos = list.filter((p) => p.git)
        let done = 0
        const results = await mapLimit(repos, FETCH_ALL_CONCURRENCY, async (project) => {
          const item = async (): Promise<FetchAllItem | null> => {
            const base = { path: project.path, name: project.name }
            // 没有配置远程的仓库不算失败，也不计入结果
            if (!(await listRemotes(project.path)).length) return null
            const result = await runFetch(project.path, {
              signal: controller.signal,
              nonInteractive: true,
              timeoutMs: FETCH_ALL_TIMEOUT_MS
            })
            return { ...base, ...result }
          }
          const result = await queue
            .run(project.path, item)
            .catch((error): FetchAllItem => ({
              path: project.path,
              name: project.name,
              ok: false,
              cancelled: false,
              message: (error as Error).message
            }))
          done++
          send(EVENT_REMOTE_PROGRESS, { opId, line: `${done} / ${repos.length}` })
          return result
        })
        return results.filter((r): r is FetchAllItem => r !== null)
      } finally {
        operations.delete(opId)
      }
    },

    cancelRemote: async (opId) => {
      if (typeof opId === 'string') operations.get(opId)?.abort()
    },

    watchRepo: async (path) => {
      watcher.watch(path === null ? null : known(path))
    }
  }

  for (const method of API_METHODS) {
    const handler = handlers[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(channelOf(method), (_event, ...args) => handler(...args))
  }
}
