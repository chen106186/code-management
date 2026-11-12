import { runGit } from './git'

function localDay(time: Date): string {
  const month = String(time.getMonth() + 1).padStart(2, '0')
  const day = String(time.getDate()).padStart(2, '0')
  return `${time.getFullYear()}-${month}-${day}`
}

/** 输入是每行一个秒级时间戳，按本地日期计数 */
export function countByDay(output: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const line of output.split('\n')) {
    const seconds = Number(line.trim())
    if (!line.trim() || !Number.isFinite(seconds)) continue
    const day = localDay(new Date(seconds * 1000))
    counts[day] = (counts[day] ?? 0) + 1
  }
  return counts
}

/** 最近一年的提交；只看自己时按仓库配置的 user.email 过滤，没配置就没有结果 */
export async function readActivity(cwd: string, mineOnly: boolean): Promise<Record<string, number>> {
  const args = ['log', '--all', '--since=1 year ago', '--format=%at']
  if (mineOnly) {
    const email = (await runGit(cwd, ['config', 'user.email'])).trim()
    if (!email) return {}
    args.push('--fixed-strings', `--author=${email}`)
  }
  return countByDay(await runGit(cwd, args))
}
