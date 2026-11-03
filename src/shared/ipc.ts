import type {
  Branch,
  CommitDetail,
  CommitSummary,
  DiffContent,
  DiffTarget,
  FetchAllItem,
  RemoteProgress,
  RemoteResult,
  RepoChanges
} from './repo'
import type { Category, ProjectMetaValues, ProjectPatch, Snapshot, ThemeSetting } from './types'

/** 渲染进程可调用的全部能力，通道名与方法名一一对应 */
export interface Api {
  refresh(): Promise<Snapshot>
  /** 以下三个方法弹出系统对话框，用户取消时返回 null */
  addRoot(): Promise<Snapshot | null>
  addProject(): Promise<Snapshot | null>
  addExcluded(): Promise<Snapshot | null>
  removeRoot(path: string): Promise<Snapshot>
  removeExcluded(path: string): Promise<Snapshot>
  hideProject(path: string): Promise<Snapshot>
  restoreProject(path: string): Promise<Snapshot>
  setFavorite(path: string, favorite: boolean): Promise<void>
  setTags(path: string, tags: string[]): Promise<string[]>
  /** 返回保存后的备注，留空表示清除，此时返回 null */
  setRemark(path: string, remark: string): Promise<string | null>
  createCategory(name: string, parentId: string | null): Promise<Category[]>
  renameCategory(id: string, name: string): Promise<Category[]>
  moveCategory(id: string, parentId: string | null, beforeId: string | null): Promise<Category[]>
  /** 弹出确认框，用户取消时返回 null */
  deleteCategory(id: string): Promise<Category[] | null>
  setProjectCategory(path: string, categoryId: string | null): Promise<void>
  /** 批量修改项目信息，返回修改后的值，键是项目路径 */
  updateProjects(paths: string[], patch: ProjectPatch): Promise<Record<string, ProjectMetaValues>>
  hideProjects(paths: string[]): Promise<Snapshot>
  /** 按旧路径确认迁移；新路径由主进程决定，不信任页面传来的值 */
  applyMoves(from: string[]): Promise<Snapshot>
  dismissMoves(from: string[]): Promise<Snapshot>
  /** 弹出保存对话框，返回保存的位置，用户取消时返回 null */
  exportConfig(): Promise<string | null>
  /** 弹出选择和确认对话框，用户取消时返回 null */
  importConfig(): Promise<Snapshot | null>
  setTheme(theme: ThemeSetting): Promise<void>
  openInEditor(path: string): Promise<void>
  openInTerminal(path: string): Promise<void>
  openInExplorer(path: string): Promise<void>
  /** 在浏览器打开远程仓库页面；地址由主进程读取，不信任页面传来的网址 */
  openRemote(path: string, remoteName: string): Promise<void>
  copyText(text: string): Promise<void>

  getChanges(path: string): Promise<RepoChanges>
  getDiff(path: string, target: DiffTarget): Promise<DiffContent>
  getLog(path: string, skip: number, limit: number): Promise<CommitSummary[]>
  getCommit(path: string, hash: string): Promise<CommitDetail>
  getBranches(path: string): Promise<Branch[]>
  /** 唯一会改动工作区的操作；会覆盖未提交改动时 git 拒绝并报错 */
  switchBranch(path: string, name: string, kind: Branch['kind']): Promise<void>
  fetchRepo(path: string, opId: string): Promise<RemoteResult>
  fetchAll(opId: string): Promise<FetchAllItem[]>
  cancelRemote(opId: string): Promise<void>
  /** 监听当前打开的仓库，传 null 停止 */
  watchRepo(path: string | null): Promise<void>
}

/** 主进程推送给渲染进程的事件，返回值用于取消订阅 */
export interface ApiEvents {
  onRemoteProgress(listener: (progress: RemoteProgress) => void): () => void
  onRepoChanged(listener: (path: string) => void): () => void
}

export const EVENT_REMOTE_PROGRESS = 'event:remoteProgress'
export const EVENT_REPO_CHANGED = 'event:repoChanged'

export const API_METHODS = [
  'refresh',
  'addRoot',
  'addProject',
  'addExcluded',
  'removeRoot',
  'removeExcluded',
  'hideProject',
  'restoreProject',
  'setFavorite',
  'setTags',
  'setRemark',
  'createCategory',
  'renameCategory',
  'moveCategory',
  'deleteCategory',
  'setProjectCategory',
  'updateProjects',
  'hideProjects',
  'applyMoves',
  'dismissMoves',
  'exportConfig',
  'importConfig',
  'setTheme',
  'openInEditor',
  'openInTerminal',
  'openInExplorer',
  'openRemote',
  'copyText',
  'getChanges',
  'getDiff',
  'getLog',
  'getCommit',
  'getBranches',
  'switchBranch',
  'fetchRepo',
  'fetchAll',
  'cancelRemote',
  'watchRepo'
] as const satisfies readonly (keyof Api)[]

export const channelOf = (method: keyof Api): string => `api:${method}`
