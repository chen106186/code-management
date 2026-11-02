import { execFile, spawn } from 'child_process'
import type { RemoteKind, RemoteResult } from '@shared/repo'
import { GIT_BASE_ARGS, gitEnv, readStatus } from './git'
import { listRemotes } from './gitOps'

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const OUTPUT_TAIL = 4000

export interface RemoteOptions {
  onProgress?: (line: string) => void
  signal?: AbortSignal
  timeoutMs?: number
  /** 批量操作时不弹出凭据窗口，否则多个仓库会连续弹窗 */
  nonInteractive?: boolean
}

async function buildArgs(cwd: string, kind: RemoteKind): Promise<string[]> {
  const remotes = await listRemotes(cwd)
  if (!remotes.length) throw new Error('没有配置远程仓库')

  if (kind === 'fetch') return ['fetch', '--progress']
  // 只快进：本地和远程分叉时停下来，不自动产生合并提交或冲突
  if (kind === 'pull') return ['pull', '--ff-only', '--progress']

  const status = await readStatus(cwd)
  if (!status.branch) throw new Error('当前是游离 HEAD，无法推送')
  if (status.upstream) return ['push', '--progress']
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  return ['push', '--progress', '-u', remote, status.branch]
}

export function describeRemoteError(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const last = lines.filter((l) => !/^(hint|remote):/.test(l)).at(-1) ?? lines.at(-1) ?? '操作失败'
  const hints: [RegExp, string][] = [
    [/Not possible to fast-forward|have diverged/i, '本地和远程已分叉，无法快进，请手动合并或变基'],
    [/no tracking information/i, '当前分支没有上游分支'],
    [/Updates were rejected|\[rejected\]/i, '推送被拒绝，远程有新提交，请先 Pull'],
    [/Authentication failed|could not read Username|terminal prompts disabled/i, '认证失败，请检查凭据'],
    [/Could not resolve host|unable to access|Failed to connect|timed out/i, '无法连接远程仓库'],
    [/would be overwritten/i, '工作区改动会被覆盖，请先提交或暂存']
  ]
  const hint = hints.find(([pattern]) => pattern.test(output))?.[1]
  return hint ? `${hint}（${last}）` : last
}

/** Windows 上只杀 git.exe 会留下 git-remote-https 等子进程 */
function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    process.kill(pid, 'SIGTERM')
  }
}

export async function runRemote(
  cwd: string,
  kind: RemoteKind,
  options: RemoteOptions = {}
): Promise<RemoteResult> {
  const cancelled: RemoteResult = { ok: false, cancelled: true, message: '已取消' }
  if (options.signal?.aborted) return cancelled

  let args: string[]
  try {
    args = await buildArgs(cwd, kind)
  } catch (error) {
    return { ok: false, cancelled: false, message: (error as Error).message }
  }
  // 准备参数期间也可能被取消，此时 abort 事件已经发过，下面的监听收不到
  if (options.signal?.aborted) return cancelled

  return new Promise((resolve) => {
    const child = spawn('git', [...GIT_BASE_ARGS, ...args], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv(options.nonInteractive ? { GCM_INTERACTIVE: 'never' } : {})
    })

    let tail = ''
    let wasCancelled = false
    let timedOut = false

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      tail = (tail + text).slice(-OUTPUT_TAIL)
      // 进度行用 \r 覆盖刷新
      const line = text.split(/[\r\n]+/).filter(Boolean).at(-1)
      if (line) options.onProgress?.(line.trim())
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    const onAbort = (): void => {
      wasCancelled = true
      killTree(child.pid)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const finish = (result: RemoteResult): void => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    child.once('error', (error) => {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      finish({ ok: false, cancelled: false, message: missing ? '未找到 git' : error.message })
    })
    // 钩子的子进程可能不在进程树里（如 MSYS 的 sleep），taskkill 杀不到，还占着输出管道，
    // close 要等它结束才触发。所以被中止时以 git 自身退出为准，并主动断开管道
    child.once('exit', () => {
      if (!wasCancelled && !timedOut) return
      child.stdout.destroy()
      child.stderr.destroy()
      finish(wasCancelled ? cancelled : { ok: false, cancelled: false, message: '操作超时' })
    })
    child.once('close', (code) => {
      if (wasCancelled || timedOut) return
      if (code === 0) return finish({ ok: true, cancelled: false, message: '' })
      finish({ ok: false, cancelled: false, message: describeRemoteError(tail) })
    })
  })
}
