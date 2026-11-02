import { execFile } from 'child_process'
import type { GitStatus } from '@shared/types'
import { LAST_COMMIT_FORMAT, parseLastCommit, parseStatus } from './gitParse'

export class GitError extends Error {
  constructor(
    message: string,
    readonly notInstalled = false
  ) {
    super(message)
  }
}

const TIMEOUT_MS = 15_000
const MAX_BUFFER = 32 * 1024 * 1024

export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // 后台轮询不抢占 index.lock；输出保持英文和原始 UTF-8，便于解析
      ['--no-optional-locks', '-c', 'core.quotepath=false', ...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(new GitError('未找到 git，请确认已安装并加入 PATH', true))
        }
        reject(new GitError(stderr.trim() || error.message))
      }
    )
  })
}

export async function readStatus(cwd: string): Promise<GitStatus> {
  const status = parseStatus(await runGit(cwd, ['status', '--porcelain=v2', '--branch', '-z']))
  const lastCommit = status.head
    ? parseLastCommit(await runGit(cwd, ['log', '-1', `--format=${LAST_COMMIT_FORMAT}`]))
    : null
  return { ...status, lastCommit }
}

export async function initRepo(cwd: string): Promise<void> {
  await runGit(cwd, ['init'])
}
