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
}

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
  'openInExplorer'
] as const satisfies readonly (keyof Api)[]

export const channelOf = (method: keyof Api): string => `api:${method}`
