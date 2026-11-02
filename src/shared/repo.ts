import type { GitStatus } from './types'

export type FileState =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export interface ChangedFile {
  path: string
  /** 重命名或复制前的路径 */
  origPath: string | null
  state: FileState
}

export interface RepoChanges {
  status: GitStatus
  staged: ChangedFile[]
  unstaged: ChangedFile[]
  conflicted: ChangedFile[]
}

export type DiffTarget =
  | { kind: 'staged' | 'unstaged'; path: string; origPath: string | null }
  | { kind: 'commit'; hash: string; parent: string | null; path: string; origPath: string | null }

export interface DiffContent {
  original: string
  modified: string
  binary: boolean
  tooLarge: boolean
}

export interface Branch {
  name: string
  kind: 'local' | 'remote'
  current: boolean
  hash: string
  upstream: string | null
  ahead: number
  behind: number
  /** 上游分支已被删除 */
  gone: boolean
  time: number
  subject: string
}

export interface CommitSummary {
  hash: string
  parents: string[]
  author: string
  email: string
  time: number
  subject: string
  /** 分支和标签，如 HEAD -> main, origin/main */
  refs: string[]
}

export interface CommitDetail extends Omit<CommitSummary, 'subject' | 'refs'> {
  message: string
  files: ChangedFile[]
}

export type RemoteKind = 'fetch' | 'pull' | 'push'

export interface RemoteResult {
  ok: boolean
  cancelled: boolean
  message: string
}

export interface FetchAllItem extends RemoteResult {
  path: string
  name: string
}

export interface RemoteProgress {
  opId: string
  line: string
}
