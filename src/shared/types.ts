export interface LastCommit {
  hash: string
  subject: string
  author: string
  /** 毫秒时间戳 */
  time: number
}

export interface RemoteInfo {
  name: string
  /** 已去掉其中的账号和令牌 */
  url: string
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
  stashCount: number
  lastCommit: LastCommit | null
  remotes: RemoteInfo[]
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
  /** 未分类时为 null */
  categoryId: string | null
  /** 用户给项目起的具体名称，没有时为 null */
  remark: string | null
  /** 后台统计的结果，还没算出来时为 null */
  stats: ProjectStats | null
}

export interface LanguageLines {
  name: string
  lines: number
}

export interface ProjectStats {
  /** 磁盘占用（字节），包含 .git */
  size: number
  /** 其中依赖和构建产物的占用 */
  generatedSize: number
  lines: number
  /** 按行数从多到少 */
  languages: LanguageLines[]
  /** 项目太大，只统计了一部分 */
  truncated: boolean
  /** 毫秒时间戳 */
  computedAt: number
}

/** 保存下来的筛选条件；取值在应用时再校验，旧版本留下的无效值会退回默认 */
export interface SavedView {
  id: string
  name: string
  filter: string
  scope: string
  activeTag: string | null
  query: string
  sort: string
  sortReverse: boolean
}

export interface Category {
  id: string
  name: string
  /** 顶层分类为 null */
  parentId: string | null
}

export type ThemeSetting = 'system' | 'light' | 'dark'

export interface Config {
  roots: string[]
  manual: string[]
  hidden: string[]
  /** 扫描时跳过的目录及其子目录，手动添加的项目不受影响 */
  excluded: string[]
  categories: Category[]
  theme: ThemeSetting
  /** 定时后台 Fetch 的间隔，0 表示关闭 */
  autoFetchMinutes: number
  /** 关闭窗口后留在托盘，定时 Fetch 继续运行 */
  closeToTray: boolean
  savedViews: SavedView[]
}

export const AUTO_FETCH_OPTIONS = [0, 15, 30, 60, 120]
export const DEFAULT_AUTO_FETCH_MINUTES = 30

export interface AutoFetchStatus {
  /** 毫秒时间戳，还没运行过时为 null */
  lastRun: number | null
  succeeded: number
  failed: { name: string; message: string }[]
}

export interface Readme {
  name: string
  content: string
  markdown: boolean
  /** 文件太大，只读取了开头 */
  truncated: boolean
}

/** 每个项目每天的提交数，键分别是项目路径和 YYYY-MM-DD */
export type Activity = Record<string, Record<string, number>>

export interface ScanError {
  path: string
  message: string
}

export interface ScanProgress {
  done: number
  total: number | null
  current: string | null
}

export interface HiddenProject {
  path: string
  name: string
  remark: string | null
}

/** 用户给项目添加的信息，按路径保存 */
export interface ProjectMetaValues {
  favorite: boolean
  tags: string[]
  categoryId: string | null
  remark: string | null
}

/** 批量修改：只改给出的字段 */
export interface ProjectPatch {
  categoryId?: string | null
  favorite?: boolean
  addTag?: string
}

/** 旧路径已不存在，新路径是 Git 地址相同的项目，迁移前要用户确认 */
export interface ProjectMove {
  from: string
  to: string
  name: string
}

export interface Snapshot {
  projects: Project[]
  hiddenProjects: HiddenProject[]
  config: Config
  scanErrors: ScanError[]
  moves: ProjectMove[]
}
