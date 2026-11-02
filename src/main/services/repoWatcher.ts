import { watch, type FSWatcher } from 'fs'

const DEBOUNCE_MS = 300
const IGNORED_DIRS = new Set(['node_modules', '__pycache__'])
const GIT_FILES = new Set(['HEAD', 'index', 'packed-refs', 'FETCH_HEAD', 'MERGE_HEAD'])

/** 判断变更是否值得刷新；.git 里只关心影响状态的文件，忽略对象库和锁文件 */
export function isRelevantChange(file: string | null): boolean {
  if (!file) return true
  const segments = file.split(/[\\/]/)
  if (segments.at(-1)?.endsWith('.lock')) return false
  if (segments[0] === '.git') {
    return segments[1] === 'refs' || GIT_FILES.has(segments[1])
  }
  return !segments.some((s) => IGNORED_DIRS.has(s))
}

/** 只监听当前打开的一个仓库；recursive 在 Windows 上只占一个系统句柄 */
export class RepoWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly onChange: (path: string) => void) {}

  watch(path: string | null): void {
    this.close()
    if (!path) return
    try {
      this.watcher = watch(path, { recursive: true }, (_event, file) => {
        if (!isRelevantChange(file)) return
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => this.onChange(path), DEBOUNCE_MS)
      })
      // 目录被删除等情况：放弃监听，页面仍可手动刷新
      this.watcher.on('error', () => this.close())
    } catch {
      this.watcher = null
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
  }
}
