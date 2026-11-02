import { readdir, stat } from 'fs/promises'
import type { Dirent } from 'fs'
import { join } from 'path'

export const DEFAULT_SCAN_DEPTH = 3

const STRONG_MARKERS = new Set([
  '.git',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'CMakeLists.txt',
  '.idea',
  '.vscode'
])

const SOURCE_FILE = /\.(html?|jsx?|tsx?|vue|py|java|go|rs|c|cc|cpp|h|cs|sln|csproj|php|rb|sh|ps1)$/i

const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  'target',
  'vendor',
  'venv',
  '__pycache__'
])

function hasStrongMarker(entries: Dirent[]): boolean {
  return entries.some((e) => STRONG_MARKERS.has(e.name))
}

function hasSourceFile(entries: Dirent[]): boolean {
  return entries.some((e) => e.isFile() && SOURCE_FILE.test(e.name))
}

/**
 * 在 root 下查找项目目录，找到后不再深入。
 * 根目录本身只认强标记：一个放了零散脚本的工作目录不应把所有子项目吞掉。
 * 不跟随符号链接和目录联接，避免循环。
 */
export async function scanRoot(root: string, maxDepth = DEFAULT_SCAN_DEPTH): Promise<string[]> {
  const found: string[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (depth === 0) throw error
      return
    }

    if (hasStrongMarker(entries) || (depth > 0 && hasSourceFile(entries))) {
      found.push(dir)
      return
    }
    if (depth >= maxDepth) return

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      await walk(join(dir, entry.name), depth + 1)
    }
  }

  await walk(root, 0)
  return found
}

const ACTIVITY_IGNORED = new Set(['.git', '.idea', '.vscode', ...SKIPPED_DIRS])
const ACTIVITY_MAX_ENTRIES = 500

/** 目录内文件的最新修改时间，只看两层并限制数量，避免大目录拖慢刷新 */
export async function latestModified(dir: string): Promise<number | null> {
  let latest: number | null = null
  let budget = ACTIVITY_MAX_ENTRIES

  async function walk(current: string, depth: number): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (budget-- <= 0) return
      if (ACTIVITY_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (depth < 2) await walk(full, depth + 1)
        continue
      }
      try {
        const { mtimeMs } = await stat(full)
        if (latest === null || mtimeMs > latest) latest = mtimeMs
      } catch {
        // 文件在遍历途中被删除，忽略
      }
    }
  }

  await walk(dir, 1)
  return latest
}
