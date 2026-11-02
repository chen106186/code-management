import { readdir, readFile } from 'fs/promises'
import { basename, join } from 'path'
import type { GitStatus, Project, ScanError, Snapshot } from '@shared/types'
import { readStatus } from './git'
import { latestModified, scanRoot } from './scanner'
import { isWithin, pathKey, type Store } from './store'
import { detectTech, type PackageJson } from './tech'

const CONCURRENCY = 6

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    return pkg && typeof pkg === 'object' ? pkg : null
  } catch {
    return null
  }
}

function newest(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function describeGitError(message: string): string {
  return /not a git repository/.test(message)
    ? '.git 无效（可能为空或已损坏），git 无法识别这个仓库'
    : message
}

export async function inspectProject(path: string): Promise<Omit<Project, 'favorite' | 'tags'>> {
  const base = { path, name: basename(path) || path }

  let names: string[]
  try {
    names = await readdir(path)
  } catch {
    return {
      ...base,
      missing: true,
      isGit: false,
      git: null,
      gitError: null,
      tech: [],
      lastActivity: null
    }
  }

  const isGit = names.includes('.git')
  let git: GitStatus | null = null
  let gitError: string | null = null
  if (isGit) {
    try {
      git = await readStatus(path)
    } catch (error) {
      gitError = describeGitError((error as Error).message)
    }
  }

  const pkg = names.includes('package.json') ? await readPackageJson(path) : null
  return {
    ...base,
    missing: false,
    isGit,
    git,
    gitError,
    tech: detectTech(names, pkg),
    lastActivity: newest(git?.lastCommit?.time ?? null, await latestModified(path))
  }
}

export class ProjectService {
  /** 最近一次快照包含的路径，IPC 只接受这些路径 */
  private known = new Set<string>()

  constructor(private readonly store: Store) {}

  isKnown(path: string): boolean {
    return this.known.has(pathKey(path))
  }

  async snapshot(): Promise<Snapshot> {
    const config = this.store.config
    const scanErrors: ScanError[] = []
    const paths = new Map<string, string>()
    const collect = (path: string): void => {
      if (!paths.has(pathKey(path))) paths.set(pathKey(path), path)
    }

    for (const root of config.roots) {
      try {
        const scanned = await scanRoot(root)
        scanned.filter((p) => !config.excluded.some((dir) => isWithin(p, dir))).forEach(collect)
      } catch (error) {
        scanErrors.push({ path: root, message: (error as Error).message })
      }
    }
    config.manual.forEach(collect)

    const hidden = new Set(config.hidden.map(pathKey))
    const visible = [...paths.values()].filter((p) => !hidden.has(pathKey(p)))

    const projects = await mapLimit(visible, CONCURRENCY, async (path) => ({
      ...(await inspectProject(path)),
      ...this.store.metaOf(path)
    }))

    this.known = new Set([...paths.keys(), ...config.hidden.map(pathKey)])
    return { projects, config, scanErrors }
  }
}
