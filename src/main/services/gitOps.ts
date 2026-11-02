import { lstat, readFile, readlink } from 'fs/promises'
import { isAbsolute, join } from 'path'
import type { Branch, CommitDetail, CommitSummary, DiffContent, DiffTarget } from '@shared/repo'
import { GitError, runGit, runGitBuffer } from './git'
import {
  BRANCH_FORMAT,
  COMMIT_DETAIL_FORMAT,
  LOG_FORMAT,
  parseBranches,
  parseLog,
  parseNameStatus
} from './gitParse'
import { isWithin } from './store'

const LONG_TIMEOUT_MS = 5 * 60_000
const MAX_ARGS_LENGTH = 20_000
const MAX_DIFF_BYTES = 2 * 1024 * 1024

/** 路径必须是仓库内的相对路径，且不能指向 .git */
export function assertRepoPath(cwd: string, path: unknown): string {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error('文件路径无效')
  const segments = path.split(/[\\/]/)
  if (segments.includes('..') || segments[0].toLowerCase() === '.git') {
    throw new Error('文件路径无效')
  }
  if (!isWithin(join(cwd, path), cwd)) throw new Error('文件路径无效')
  return path
}

export function assertHash(hash: unknown): string {
  if (typeof hash !== 'string' || !/^[0-9a-f]{7,64}$/i.test(hash)) throw new Error('提交号无效')
  return hash
}

/** 分批执行，避免文件很多时超过 Windows 命令行长度限制 */
async function forPathChunks(paths: string[], fn: (chunk: string[]) => Promise<unknown>): Promise<void> {
  let chunk: string[] = []
  let length = 0
  for (const path of paths) {
    if (chunk.length && length + path.length > MAX_ARGS_LENGTH) {
      await fn(chunk)
      chunk = []
      length = 0
    }
    chunk.push(path)
    length += path.length + 3
  }
  if (chunk.length) await fn(chunk)
}

export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  await forPathChunks(paths, (chunk) => runGit(cwd, ['add', '-A', '--', ...chunk]))
}

/** 用 reset 而不是 restore --staged：尚无提交的仓库也能取消暂存 */
export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  await forPathChunks(paths, (chunk) => runGit(cwd, ['reset', '-q', '--', ...chunk]))
}

export async function commit(cwd: string, message: string): Promise<void> {
  if (!message.trim()) throw new Error('提交信息不能为空')
  // 走 stdin：多行和特殊字符都不必转义；提交钩子可能较慢，放宽超时
  await runGit(cwd, ['commit', '-F', '-'], { input: message, timeoutMs: LONG_TIMEOUT_MS })
}

const TOO_LARGE = Symbol('too-large')
type FileBytes = Buffer | null | typeof TOO_LARGE

/** 文件在该版本中不存在时返回 null，其他失败照常抛出 */
async function readRevision(cwd: string, spec: string): Promise<FileBytes> {
  try {
    return await runGitBuffer(cwd, ['show', spec], { maxBuffer: MAX_DIFF_BYTES })
  } catch (error) {
    if (error instanceof GitError) {
      if (error.tooLarge) return TOO_LARGE
      // 文件名含中文且不在该版本时，git 报的是 ambiguous argument 而不是 exists on disk
      if (
        /does not exist|exists on disk|invalid object name|bad object|not a valid object|ambiguous argument/i.test(
          error.message
        )
      ) {
        return null
      }
    }
    throw error
  }
}

async function readWorkingFile(cwd: string, path: string): Promise<FileBytes> {
  const full = join(cwd, path)
  try {
    const info = await lstat(full)
    // 符号链接显示其目标，和 git 记录的内容一致；不跟随到仓库外
    if (info.isSymbolicLink()) return Buffer.from(await readlink(full))
    if (!info.isFile()) return null
    if (info.size > MAX_DIFF_BYTES) return TOO_LARGE
    return await readFile(full)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readSides(cwd: string, target: DiffTarget): Promise<[FileBytes, FileBytes]> {
  const before = target.origPath ?? target.path
  switch (target.kind) {
    case 'staged':
      return [await readRevision(cwd, `HEAD:${before}`), await readRevision(cwd, `:${target.path}`)]
    case 'unstaged':
      return [await readRevision(cwd, `:${before}`), await readWorkingFile(cwd, target.path)]
    case 'commit':
      return [
        target.parent ? await readRevision(cwd, `${target.parent}:${before}`) : null,
        await readRevision(cwd, `${target.hash}:${target.path}`)
      ]
  }
}

const isBinary = (bytes: Buffer | null): boolean =>
  bytes !== null && bytes.subarray(0, 8192).includes(0)

export async function readDiff(cwd: string, target: DiffTarget): Promise<DiffContent> {
  const [original, modified] = await readSides(cwd, target)
  const empty = { original: '', modified: '' }
  if (original === TOO_LARGE || modified === TOO_LARGE) {
    return { ...empty, binary: false, tooLarge: true }
  }
  if (isBinary(original) || isBinary(modified)) return { ...empty, binary: true, tooLarge: false }
  return {
    original: original?.toString('utf8') ?? '',
    modified: modified?.toString('utf8') ?? '',
    binary: false,
    tooLarge: false
  }
}

export async function readLog(cwd: string, skip: number, limit: number): Promise<CommitSummary[]> {
  try {
    return parseLog(await runGit(cwd, ['log', `--skip=${skip}`, `-n${limit}`, `--format=${LOG_FORMAT}`]))
  } catch (error) {
    if (/does not have any commits|bad default revision/i.test((error as Error).message)) return []
    throw error
  }
}

export async function readCommit(cwd: string, hash: string): Promise<CommitDetail> {
  const output = await runGit(cwd, ['show', '-s', `--format=${COMMIT_DETAIL_FORMAT}`, hash])
  const [fullHash, parents, author, email, seconds, message] = output.split('\0')
  const parentList = parents ? parents.split(' ') : []
  // 合并提交和第一父提交比较；根提交和空树比较
  const names = parentList.length
    ? await runGit(cwd, ['diff', '--name-status', '-M', '-z', parentList[0], hash])
    : await runGit(cwd, ['diff-tree', '--root', '-r', '-M', '--name-status', '-z', '--no-commit-id', hash])
  return {
    hash: fullHash,
    parents: parentList,
    author,
    email,
    time: parseInt(seconds, 10) * 1000,
    message: message.trimEnd(),
    files: parseNameStatus(names)
  }
}

export async function listBranches(cwd: string): Promise<Branch[]> {
  return parseBranches(
    await runGit(cwd, [
      'for-each-ref',
      '--sort=-committerdate',
      `--format=${BRANCH_FORMAT}`,
      'refs/heads',
      'refs/remotes'
    ])
  )
}

async function assertBranchName(cwd: string, name: unknown): Promise<string> {
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-')) {
    throw new Error('分支名无效')
  }
  try {
    await runGit(cwd, ['check-ref-format', '--branch', name])
  } catch {
    throw new Error(`分支名无效：${name}`)
  }
  return name
}

export async function switchBranch(cwd: string, name: string, kind: Branch['kind']): Promise<void> {
  const branch = await assertBranchName(cwd, name)
  // 工作区改动会被覆盖时 git 会拒绝并报错，这里不加 --force 或 --discard-changes
  await runGit(cwd, kind === 'remote' ? ['switch', '--track', branch] : ['switch', '--no-guess', branch], {
    timeoutMs: LONG_TIMEOUT_MS
  })
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  await runGit(cwd, ['switch', '-c', await assertBranchName(cwd, name)])
}

/** 只用 -d：未合并的分支由 git 拒绝删除，不提供强制删除 */
export async function deleteBranch(cwd: string, name: string): Promise<void> {
  const branch = await assertBranchName(cwd, name)
  try {
    await runGit(cwd, ['branch', '-d', branch])
  } catch (error) {
    if (/not fully merged/.test((error as Error).message)) {
      throw new Error(`分支 ${branch} 还有未合并的提交，没有删除`)
    }
    throw error
  }
}

export async function listRemotes(cwd: string): Promise<string[]> {
  return (await runGit(cwd, ['remote'])).split('\n').filter(Boolean)
}
