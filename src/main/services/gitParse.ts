import type { GitStatus, LastCommit } from '@shared/types'

export type ParsedStatus = Omit<GitStatus, 'lastCommit'>

/** 解析 `git status --porcelain=v2 --branch -z` 的输出 */
export function parseStatus(output: string): ParsedStatus {
  const status: ParsedStatus = {
    branch: null,
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0
  }

  const tokens = output.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue

    if (token.startsWith('# ')) {
      parseHeader(token, status)
      continue
    }

    switch (token[0]) {
      case '1':
        countChange(token.slice(2, 4), status)
        break
      case '2':
        countChange(token.slice(2, 4), status)
        // 重命名条目的下一个 token 是原路径，不是独立条目
        i++
        break
      case 'u':
        status.conflicted++
        break
      case '?':
        status.untracked++
        break
    }
  }
  return status
}

function parseHeader(line: string, status: ParsedStatus): void {
  const [, key, ...values] = line.split(' ')
  const value = values.join(' ')
  switch (key) {
    case 'branch.oid':
      status.head = value === '(initial)' ? null : value
      break
    case 'branch.head':
      status.branch = value === '(detached)' ? null : value
      break
    case 'branch.upstream':
      status.upstream = value
      break
    case 'branch.ab':
      status.ahead = Math.abs(parseInt(values[0], 10)) || 0
      status.behind = Math.abs(parseInt(values[1], 10)) || 0
      break
  }
}

function countChange(xy: string, status: ParsedStatus): void {
  if (xy[0] !== '.') status.staged++
  if (xy[1] !== '.') status.unstaged++
}

export const LAST_COMMIT_FORMAT = '%H%x00%s%x00%an%x00%ct'

/** 解析 `git log -1 --format=LAST_COMMIT_FORMAT` 的输出 */
export function parseLastCommit(output: string): LastCommit | null {
  const parts = output.trimEnd().split('\0')
  if (parts.length < 4) return null
  const [hash, subject, author, seconds] = parts
  return { hash, subject, author, time: parseInt(seconds, 10) * 1000 }
}
