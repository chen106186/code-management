export interface LastCommit {
  hash: string
  subject: string
  author: string
  /** 毫秒时间戳 */
  time: number
}

export interface GitStatus {
  /** 游离 HEAD 时为 null */
  branch: string | null
  /** 尚无提交时为 null */
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
  lastCommit: LastCommit | null
}

export interface Project {
  path: string
  name: string
  /** 路径已不存在（仅手动添加的项目可能出现） */
  missing: boolean
  isGit: boolean
  git: GitStatus | null
  /** git 命令失败时的错误信息，例如 dubious ownership */
  gitError: string | null
  tech: string[]
  /** 最后提交时间与文件修改时间中较新者（毫秒） */
  lastActivity: number | null
  favorite: boolean
  tags: string[]
}

export interface Config {
  roots: string[]
  manual: string[]
  hidden: string[]
  /** 扫描时跳过的目录及其子目录，手动添加的项目不受影响 */
  excluded: string[]
}

export interface ScanError {
  path: string
  message: string
}

export interface Snapshot {
  projects: Project[]
  config: Config
  scanErrors: ScanError[]
}
