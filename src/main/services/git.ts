import { execFile } from 'child_process'
import type { RepoChanges } from '@shared/repo'
import type { GitStatus } from '@shared/types'
import { LAST_COMMIT_FORMAT, parseChanges, parseLastCommit, parseStatus } from './gitParse'

export class GitError extends Error {
  constructor(
    message: string,
    readonly notInstalled = false,
    readonly tooLarge = false
  ) {
    super(message)
  }
}

const TIMEOUT_MS = 15_000
const MAX_BUFFER = 32 * 1024 * 1024

// 后台轮询不抢占 index.lock；路径一律按字面匹配；输出保持英文和原始 UTF-8，便于解析
export const GIT_BASE_ARGS = ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=false']

export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...extra }
}

export interface RunOptions {
  /** 写入 stdin 的内容 */
  input?: string
  timeoutMs?: number
  maxBuffer?: number
}

function run<T extends string | Buffer>(
  cwd: string,
  args: string[],
  encoding: 'utf8' | 'buffer',
  options: RunOptions
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...GIT_BASE_ARGS, ...args],
      {
        cwd,
        encoding,
        timeout: options.timeoutMs ?? TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? MAX_BUFFER,
        windowsHide: true,
        env: gitEnv()
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout as T)
        const code = (error as NodeJS.ErrnoException).code as unknown
        if (code === 'ENOENT') {
          return reject(new GitError('未找到 git，请确认已安装并加入 PATH', true))
        }
        if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          return reject(new GitError('输出过大', false, true))
        }
        // hint 行是给命令行用户的建议，比如教人用 -D 强制删除，界面上不显示
        const message = stderr
          .toString()
          .split(/\r?\n/)
          .filter((line) => !line.startsWith('hint:'))
          .join('\n')
          .trim()
        reject(new GitError(message || error.message))
      }
    )
    child.stdin?.end(options.input)
  })
}

export function runGit(cwd: string, args: string[], options: RunOptions = {}): Promise<string> {
  return run<string>(cwd, args, 'utf8', options)
}

export function runGitBuffer(cwd: string, args: string[], options: RunOptions = {}): Promise<Buffer> {
  return run<Buffer>(cwd, args, 'buffer', options)
}

const STATUS_ARGS = ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']

async function withLastCommit(cwd: string, output: string): Promise<GitStatus> {
  const status = parseStatus(output)
  const lastCommit = status.head
    ? parseLastCommit(await runGit(cwd, ['log', '-1', `--format=${LAST_COMMIT_FORMAT}`]))
    : null
  return { ...status, lastCommit }
}

export async function readStatus(cwd: string): Promise<GitStatus> {
  return withLastCommit(cwd, await runGit(cwd, STATUS_ARGS))
}

export async function readChanges(cwd: string): Promise<RepoChanges> {
  const output = await runGit(cwd, STATUS_ARGS)
  return { status: await withLastCommit(cwd, output), ...parseChanges(output) }
}

export async function initRepo(cwd: string): Promise<void> {
  await runGit(cwd, ['init'])
}
