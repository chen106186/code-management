import { readdir, readFile, stat, writeFile, mkdir } from 'fs/promises'
import type { Dirent } from 'fs'
import { readFileSync } from 'fs'
import { dirname, extname, join } from 'path'
import type { LanguageLines, ProjectStats } from '@shared/types'
import { runGit } from './git'
import { pathKey } from './store'

const WORKERS = 2
const MAX_ENTRIES = 300_000
const MAX_SOURCE_FILES = 20_000
/** 更大的源文件基本是生成的，不计入行数 */
const MAX_SOURCE_BYTES = 1024 * 1024
const STALE_MS = 24 * 3_600_000

/** 可以删掉重新生成的目录，占用单独统计，也不计入代码行数 */
const GENERATED_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.next',
  '.nuxt',
  '.gradle'
])

const LANGUAGES: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.py': 'Python',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.go': 'Go',
  '.rs': 'Rust',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.dart': 'Dart',
  '.lua': 'Lua',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.ps1': 'PowerShell',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'Sass',
  '.sass': 'Sass',
  '.less': 'Less',
  '.sql': 'SQL',
  '.scala': 'Scala'
}

export function languageOf(fileName: string): string | null {
  if (/\.min\.(js|css)$/i.test(fileName)) return null
  return LANGUAGES[extname(fileName).toLowerCase()] ?? null
}

export function countLines(content: Buffer): number {
  if (!content.length) return 0
  let lines = content[content.length - 1] === 0x0a ? 0 : 1
  for (const byte of content) if (byte === 0x0a) lines++
  return lines
}

interface WalkResult {
  size: number
  generatedSize: number
  /** 不在生成目录和隐藏目录里的文件，相对路径 */
  files: string[]
  truncated: boolean
}

async function walk(root: string): Promise<WalkResult> {
  const result: WalkResult = { size: 0, generatedSize: 0, files: [], truncated: false }
  const stack = [{ dir: root, relative: '', generated: false, hidden: false }]
  let budget = MAX_ENTRIES

  while (stack.length) {
    const { dir, relative, generated, hidden } = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (budget-- <= 0) {
        result.truncated = true
        return result
      }
      // 不跟随符号链接和目录联接，避免循环，也不把别处的文件算进来
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        stack.push({
          dir: full,
          relative: childRelative,
          generated: generated || GENERATED_DIRS.has(entry.name),
          hidden: hidden || entry.name.startsWith('.')
        })
      } else if (entry.isFile()) {
        try {
          const { size } = await stat(full)
          result.size += size
          if (generated) result.generatedSize += size
          else if (!hidden) result.files.push(childRelative)
        } catch {
          // 文件在遍历途中被删除，忽略
        }
      }
    }
  }
  return result
}

/**
 * Git 仓库只算受跟踪的文件，被忽略的生成文件不算代码。
 * 必须是项目自己的 .git：放在别的仓库子目录里时，git 查到的是外层仓库，可能一个文件也没有。
 */
async function sourceFiles(root: string, walked: string[]): Promise<string[]> {
  try {
    await stat(join(root, '.git'))
    const tracked = await runGit(root, ['ls-files', '-z'])
    return tracked.split('\0').filter(Boolean)
  } catch {
    return walked
  }
}

export async function computeStats(root: string, now = Date.now()): Promise<ProjectStats> {
  const walked = await walk(root)
  const files = (await sourceFiles(root, walked.files)).filter((file) => languageOf(file) !== null)
  const counted = files.slice(0, MAX_SOURCE_FILES)

  const byLanguage = new Map<string, number>()
  for (const file of counted) {
    try {
      const full = join(root, file)
      if ((await stat(full)).size > MAX_SOURCE_BYTES) continue
      const name = languageOf(file)!
      byLanguage.set(name, (byLanguage.get(name) ?? 0) + countLines(await readFile(full)))
    } catch {
      // 受跟踪但已从工作区删除的文件，忽略
    }
  }

  const languages: LanguageLines[] = [...byLanguage]
    .map(([name, lines]) => ({ name, lines }))
    .filter((language) => language.lines > 0)
    .sort((a, b) => b.lines - a.lines)
  return {
    size: walked.size,
    generatedSize: walked.generatedSize,
    lines: languages.reduce((sum, language) => sum + language.lines, 0),
    languages,
    truncated: walked.truncated || files.length > counted.length,
    computedAt: now
  }
}

/** 在后台逐个统计并缓存到文件；大项目可能要算很久，不能放进刷新流程 */
export class StatsService {
  private cache: Record<string, ProjectStats> = {}
  private queue: string[] = []
  private readonly queued = new Set<string>()
  private workers = 0
  private idleResolvers: (() => void)[] = []

  onUpdate: (path: string, stats: ProjectStats) => void = () => {}

  constructor(
    private readonly file: string,
    private readonly compute: (path: string) => Promise<ProjectStats> = computeStats
  ) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      if (saved && typeof saved === 'object') this.cache = saved
    } catch {
      // 缓存丢了重新算就行
    }
  }

  get(path: string): ProjectStats | null {
    return this.cache[pathKey(path)] ?? null
  }

  /** 只排没算过或已过期的项目；force 时全部重算 */
  schedule(paths: string[], force = false, now = Date.now()): void {
    for (const path of paths) {
      const current = this.get(path)
      const fresh = current && now - current.computedAt < STALE_MS
      if ((fresh && !force) || this.queued.has(pathKey(path))) continue
      this.queued.add(pathKey(path))
      this.queue.push(path)
    }
    while (this.workers < WORKERS && this.queue.length) {
      this.workers++
      void this.work()
    }
  }

  private async work(): Promise<void> {
    while (this.queue.length) {
      const path = this.queue.shift()!
      try {
        const stats = await this.compute(path)
        this.cache[pathKey(path)] = stats
        this.onUpdate(path, stats)
      } catch {
        // 目录读不了时下次再试
      }
      this.queued.delete(pathKey(path))
    }
    this.workers--
    if (this.workers === 0) {
      await this.persist()
      this.idleResolvers.splice(0).forEach((resolve) => resolve())
    }
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, JSON.stringify(this.cache), 'utf8')
    } catch {
      // 只是缓存，写不了下次重算
    }
  }

  whenIdle(): Promise<void> {
    if (this.workers === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleResolvers.push(resolve))
  }
}
