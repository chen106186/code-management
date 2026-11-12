import { access, readdir, readFile } from 'fs/promises'
import { basename, join } from 'path'
import { remoteIdentity } from '@shared/remotes'
import type { GitStatus, Project, ProjectMove, ScanError, Snapshot } from '@shared/types'
import { readStatus } from './git'
import type { StatsService } from './projectStats'
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

export async function inspectProject(
  path: string
): Promise<Omit<Project, 'favorite' | 'tags' | 'categoryId' | 'remark' | 'stats'>> {
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

function primaryRemote(git: GitStatus | null): string | null {
  const remote = git?.remotes.find((r) => r.name === 'origin') ?? git?.remotes[0]
  return remote ? remoteIdentity(remote.url) : null
}

/** 同一个地址有多个旧路径或多个新项目时无法判断对应关系，宁可不提示 */
export function pairMoves(
  sources: { from: string; remote: string }[],
  targets: { path: string; remote: string }[]
): { from: string; to: string }[] {
  return sources.flatMap(({ from, remote }) => {
    const sameSource = sources.filter((s) => s.remote === remote)
    const sameTarget = targets.filter((t) => t.remote === remote)
    return sameSource.length === 1 && sameTarget.length === 1 ? [{ from, to: sameTarget[0].path }] : []
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export class ProjectService {
  /** 最近一次快照包含的路径，IPC 只接受这些路径 */
  private known = new Set<string>()
  /** 最近一次快照给出的迁移建议，确认时只接受这些 */
  private moves: ProjectMove[] = []
  private statsPaths: string[] = []

  onSnapshot: (snapshot: Snapshot) => void = () => {}

  constructor(
    private readonly store: Store,
    private readonly stats: StatsService
  ) {}

  recomputeStats(): void {
    this.stats.schedule(this.statsPaths, true)
  }

  isKnown(path: string): boolean {
    return this.known.has(pathKey(path))
  }

  suggestedMoves(from: string[]): ProjectMove[] {
    const keys = new Set(from.map(pathKey))
    return this.moves.filter((move) => keys.has(pathKey(move.from)))
  }

  /** 旧路径还在的是两份副本，不算移动；已有信息的项目不覆盖 */
  private async findMoves(projects: Project[]): Promise<ProjectMove[]> {
    const targets = projects.flatMap((p) => {
      const remote = primaryRemote(p.git)
      const { favorite, tags, categoryId, remark } = this.store.metaOf(p.path)
      const blank = !favorite && !tags.length && categoryId === null && remark === null
      return remote && blank ? [{ path: p.path, remote }] : []
    })
    const remotes = new Set(targets.map((t) => t.remote))
    const candidates = this.store.moveSources().filter((s) => remotes.has(s.remote))
    const exists = await Promise.all(candidates.map((s) => pathExists(s.from)))
    const sources = candidates.filter((_, index) => !exists[index])
    return pairMoves(sources, targets).map(({ from, to }) => ({
      from,
      to,
      name: this.store.metaOf(from).remark ?? (basename(from) || from)
    }))
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
      ...this.store.metaOf(path),
      stats: this.stats.get(path)
    }))

    this.store.trackProjects(
      projects.filter((p) => !p.missing).map((p) => ({ path: p.path, remote: primaryRemote(p.git) }))
    )
    this.moves = await this.findMoves(projects)

    this.known = new Set([...paths.keys(), ...config.hidden.map(pathKey)])
    // 隐藏的项目只列名称，不跑 git，不拖慢刷新
    const hiddenProjects = config.hidden.map((path) => ({
      path,
      name: basename(path) || path,
      remark: this.store.metaOf(path).remark
    }))
    const snapshot = { projects, hiddenProjects, config, scanErrors, moves: this.moves }
    this.statsPaths = projects.filter((p) => !p.missing).map((p) => p.path)
    this.stats.schedule(this.statsPaths)
    this.onSnapshot(snapshot)
    return snapshot
  }
}
