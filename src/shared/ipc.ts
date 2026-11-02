import type {
  Branch,
  CommitDetail,
  CommitSummary,
  DiffContent,
  DiffTarget,
  FetchAllItem,
  RemoteKind,
  RemoteProgress,
  RemoteResult,
  RepoChanges
} from './repo'
import type { Snapshot } from './types'

/** 渲染进程可调用的全部能力，通道名与方法名一一对应 */
export interface Api {
  refresh(): Promise<Snapshot>
  /** 以下四个方法弹出系统对话框，用户取消时返回 null */
  addRoot(): Promise<Snapshot | null>
  addProject(): Promise<Snapshot | null>
  addExcluded(): Promise<Snapshot | null>
  initGit(path: string): Promise<Snapshot | null>
  removeRoot(path: string): Promise<Snapshot>
  removeExcluded(path: string): Promise<Snapshot>
  hideProject(path: string): Promise<Snapshot>
  restoreProject(path: string): Promise<Snapshot>
  setFavorite(path: string, favorite: boolean): Promise<void>
  setTags(path: string, tags: string[]): Promise<string[]>
  openInEditor(path: string): Promise<void>
  openInTerminal(path: string): Promise<void>
  openInExplorer(path: string): Promise<void>

  getChanges(path: string): Promise<RepoChanges>
  getDiff(path: string, target: DiffTarget): Promise<DiffContent>
  stage(path: string, files: string[]): Promise<void>
  unstage(path: string, files: string[]): Promise<void>
  commit(path: string, message: string): Promise<void>
  getLog(path: string, skip: number, limit: number): Promise<CommitSummary[]>
  getCommit(path: string, hash: string): Promise<CommitDetail>
  getBranches(path: string): Promise<Branch[]>
  switchBranch(path: string, name: string, kind: Branch['kind']): Promise<void>
  createBranch(path: string, name: string): Promise<void>
  /** 弹出确认框，用户取消时返回 false */
  deleteBranch(path: string, name: string): Promise<boolean>
  runRemote(path: string, kind: RemoteKind, opId: string): Promise<RemoteResult>
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
  'initGit',
  'removeRoot',
  'removeExcluded',
  'hideProject',
  'restoreProject',
  'setFavorite',
  'setTags',
  'openInEditor',
  'openInTerminal',
  'openInExplorer',
  'getChanges',
  'getDiff',
  'stage',
  'unstage',
  'commit',
  'getLog',
  'getCommit',
  'getBranches',
  'switchBranch',
  'createBranch',
  'deleteBranch',
  'runRemote',
  'fetchAll',
  'cancelRemote',
  'watchRepo'
] as const satisfies readonly (keyof Api)[]

export const channelOf = (method: keyof Api): string => `api:${method}`
