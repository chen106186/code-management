import type { Branch, ChangedFile, CommitSummary, FileState, RepoChanges } from '@shared/repo'
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

const STATE_BY_LETTER: Record<string, FileState> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange'
}

/** 跳过前 count 个空格分隔的字段，路径可能含空格，所以不能直接 split */
function afterFields(token: string, count: number): string {
  let index = 0
  for (let i = 0; i < count; i++) index = token.indexOf(' ', index) + 1
  return token.slice(index)
}

/** 从与 parseStatus 相同的输出中取出文件列表 */
export function parseChanges(output: string): Omit<RepoChanges, 'status'> {
  const changes: Omit<RepoChanges, 'status'> = { staged: [], unstaged: [], conflicted: [] }

  const add = (xy: string, path: string, origPath: string | null): void => {
    const entry = (letter: string): ChangedFile => ({
      path,
      origPath: letter === 'R' || letter === 'C' ? origPath : null,
      state: STATE_BY_LETTER[letter] ?? 'modified'
    })
    if (xy[0] !== '.') changes.staged.push(entry(xy[0]))
    if (xy[1] !== '.') changes.unstaged.push(entry(xy[1]))
  }

  const tokens = output.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    switch (token[0]) {
      case '1':
        add(token.slice(2, 4), afterFields(token, 8), null)
        break
      case '2':
        add(token.slice(2, 4), afterFields(token, 9), tokens[++i])
        break
      case 'u':
        changes.conflicted.push({
          path: afterFields(token, 10),
          origPath: null,
          state: 'conflicted'
        })
        break
      case '?':
        changes.unstaged.push({ path: token.slice(2), origPath: null, state: 'untracked' })
        break
    }
  }
  return changes
}

export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%ct%x00%s%x00%D%x1e'

export function parseLog(output: string): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const record of output.split('\x1e')) {
    const trimmed = record.replace(/^\s+/, '')
    if (!trimmed) continue
    const [hash, parents, author, email, seconds, subject, refs] = trimmed.split('\0')
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      author,
      email,
      time: parseInt(seconds, 10) * 1000,
      subject,
      refs: refs ? refs.split(', ') : []
    })
  }
  return commits
}

export const COMMIT_DETAIL_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%ct%x00%B'

/** 解析 `--name-status -z` 的输出；重命名和复制占三个 token */
export function parseNameStatus(output: string): ChangedFile[] {
  const files: ChangedFile[] = []
  const tokens = output.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]
    if (!code) continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      const origPath = tokens[++i]
      files.push({ path: tokens[++i], origPath, state: STATE_BY_LETTER[letter] })
    } else {
      files.push({ path: tokens[++i], origPath: null, state: STATE_BY_LETTER[letter] ?? 'modified' })
    }
  }
  return files
}

export const BRANCH_FORMAT = [
  '%(refname)',
  '%(objectname:short)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(committerdate:unix)',
  '%(HEAD)',
  '%(contents:subject)'
].join('%00')

export function parseBranches(output: string): Branch[] {
  const branches: Branch[] = []
  for (const line of output.split('\n')) {
    if (!line) continue
    const [ref, hash, upstream, track, seconds, head, subject] = line.split('\0')
    const isRemote = ref.startsWith('refs/remotes/')
    // origin/HEAD 只是指向默认分支的别名
    if (isRemote && ref.endsWith('/HEAD')) continue
    branches.push({
      name: ref.replace(/^refs\/(heads|remotes)\//, ''),
      kind: isRemote ? 'remote' : 'local',
      current: head === '*',
      hash,
      upstream: upstream || null,
      ahead: parseInt(/ahead (\d+)/.exec(track)?.[1] ?? '0', 10),
      behind: parseInt(/behind (\d+)/.exec(track)?.[1] ?? '0', 10),
      gone: track === 'gone',
      time: parseInt(seconds, 10) * 1000 || 0,
      subject: subject ?? ''
    })
  }
  return branches
}

export const LAST_COMMIT_FORMAT = '%H%x00%s%x00%an%x00%ct'

/** 解析 `git log -1 --format=LAST_COMMIT_FORMAT` 的输出 */
export function parseLastCommit(output: string): LastCommit | null {
  const parts = output.trimEnd().split('\0')
  if (parts.length < 4) return null
  const [hash, subject, author, seconds] = parts
  return { hash, subject, author, time: parseInt(seconds, 10) * 1000 }
}
