import { BrowserWindow, dialog, ipcMain } from 'electron'
import { API_METHODS, channelOf, type Api } from '@shared/ipc'
import { initRepo } from './services/git'
import { openInEditor, openInExplorer, openInTerminal } from './services/openers'
import type { ProjectService } from './services/projects'
import type { Store } from './services/store'

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

    initGit: async (path) => {
      const target = known(path)
      const { response } = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        title: '初始化 Git 仓库',
        message: `在此目录运行 git init？`,
        detail: `${target}\n\n只会创建 .git 目录，不会改动现有文件，也不会自动提交。`,
        buttons: ['初始化', '取消'],
        defaultId: 0,
        cancelId: 1
      })
      if (response !== 0) return null
      await initRepo(target)
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

    openInEditor: (path) => openInEditor(known(path)),
    openInTerminal: (path) => openInTerminal(known(path)),
    openInExplorer: (path) => openInExplorer(known(path))
  }

  for (const method of API_METHODS) {
    const handler = handlers[method] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(channelOf(method), (_event, ...args) => handler(...args))
  }
}
