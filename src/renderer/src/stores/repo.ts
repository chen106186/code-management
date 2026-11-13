import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  Branch,
  ChangedFile,
  CommitDetail,
  CommitSummary,
  DiffTarget,
  RepoChanges
} from '@shared/repo'
import { errorMessage } from '@renderer/lib/errors'

const LOG_PAGE = 100

export type RepoTab = 'changes' | 'history' | 'branches' | 'info'
export type RemoteKind = 'fetch' | 'pull'

/** 英文和中文之间留空格：Fetch 完成、拉取完成 */
const remoteText = (kind: RemoteKind, text: string): string =>
  kind === 'fetch' ? `Fetch ${text}` : `拉取${text}`
type ChangeTarget = Extract<DiffTarget, { kind: 'staged' | 'unstaged' }>

export const useRepoStore = defineStore('repo', () => {
  const path = ref<string | null>(null)
  const tab = ref<RepoTab>('changes')
  const changes = ref<RepoChanges | null>(null)
  const branches = ref<Branch[]>([])
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)

  const changeTarget = ref<ChangeTarget | null>(null)
  /** 每次刷新递增，让 Diff 重新读取文件内容 */
  const changeVersion = ref(0)

  const commits = ref<CommitSummary[]>([])
  const hasMoreCommits = ref(false)
  const loadingCommits = ref(false)
  const commitDetail = ref<CommitDetail | null>(null)
  const commitTarget = ref<DiffTarget | null>(null)

  /** 正在进行的远程操作；同一时间只允许一个 */
  const fetching = ref<{ kind: RemoteKind; opId: string; line: string } | null>(null)

  let refreshId = 0
  let logHead: string | null | undefined
  let unsubscribe: (() => void) | null = null

  /** 文件在外部被暂存或取消暂存后跟到另一侧；已不存在则取消选中 */
  function reconcileTarget(next: RepoChanges): void {
    const target = changeTarget.value
    if (!target) return
    const has = (files: ChangedFile[]): boolean => files.some((f) => f.path === target.path)
    const unstagedSide = [...next.unstaged, ...next.conflicted]
    const [same, other] = target.kind === 'staged' ? [next.staged, unstagedSide] : [unstagedSide, next.staged]
    if (has(same)) return
    if (has(other)) {
      const file = other.find((f) => f.path === target.path)!
      changeTarget.value = {
        kind: target.kind === 'staged' ? 'unstaged' : 'staged',
        path: file.path,
        origPath: file.origPath
      }
    } else {
      changeTarget.value = null
    }
  }

  async function refresh(): Promise<void> {
    const repo = path.value
    if (!repo) return
    const id = ++refreshId
    try {
      const [nextChanges, nextBranches] = await Promise.all([
        window.api.getChanges(repo),
        window.api.getBranches(repo)
      ])
      // 期间切换了仓库或发起了更新的刷新时丢弃结果
      if (id !== refreshId || repo !== path.value) return
      changes.value = nextChanges
      branches.value = nextBranches
      reconcileTarget(nextChanges)
      changeVersion.value++
      if (nextChanges.status.head !== logHead) await reloadLog()
    } catch (e) {
      if (id === refreshId) error.value = errorMessage(e)
    }
  }

  async function reloadLog(): Promise<void> {
    commits.value = []
    hasMoreCommits.value = true
    logHead = changes.value?.status.head
    await loadMoreCommits()
  }

  async function loadMoreCommits(): Promise<void> {
    const repo = path.value
    if (!repo || loadingCommits.value || !hasMoreCommits.value) return
    loadingCommits.value = true
    try {
      const page = await window.api.getLog(repo, commits.value.length, LOG_PAGE)
      if (repo !== path.value) return
      commits.value = [...commits.value, ...page]
      hasMoreCommits.value = page.length === LOG_PAGE
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      loadingCommits.value = false
    }
  }

  async function selectCommit(hash: string): Promise<void> {
    const repo = path.value
    if (!repo) return
    try {
      const detail = await window.api.getCommit(repo, hash)
      if (repo !== path.value) return
      commitDetail.value = detail
      const first = detail.files[0]
      if (first) selectCommitFile(first)
      else commitTarget.value = null
    } catch (e) {
      error.value = errorMessage(e)
    }
  }

  function selectCommitFile(file: ChangedFile): void {
    const detail = commitDetail.value
    if (!detail) return
    commitTarget.value = {
      kind: 'commit',
      hash: detail.hash,
      parent: detail.parents[0] ?? null,
      path: file.path,
      origPath: file.origPath
    }
  }

  function selectChange(kind: ChangeTarget['kind'], file: ChangedFile): void {
    changeTarget.value = { kind, path: file.path, origPath: file.origPath }
  }

  async function runRemote(kind: RemoteKind): Promise<void> {
    const repo = path.value
    if (!repo || fetching.value) return
    const opId = `${kind}-${Date.now()}`
    fetching.value = { kind, opId, line: '' }
    error.value = null
    notice.value = null
    const off = window.api.onRemoteProgress((progress) => {
      if (fetching.value?.opId === progress.opId) fetching.value.line = progress.line
    })
    try {
      const result = await (kind === 'pull' ? window.api.pullRepo(repo, opId) : window.api.fetchRepo(repo, opId))
      if (result.cancelled) notice.value = remoteText(kind, '已取消')
      else if (result.ok) notice.value = remoteText(kind, '完成')
      else error.value = `${remoteText(kind, '失败')}：${result.message}`
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      off()
      fetching.value = null
    }
    await refresh()
  }

  const fetchRemote = (): Promise<void> => runRemote('fetch')
  const pullRemote = (): Promise<void> => runRemote('pull')

  function cancelFetch(): void {
    if (fetching.value) void window.api.cancelRemote(fetching.value.opId)
  }

  async function open(repo: string): Promise<void> {
    path.value = repo
    tab.value = 'changes'
    changes.value = null
    branches.value = []
    commits.value = []
    commitDetail.value = null
    commitTarget.value = null
    changeTarget.value = null
    error.value = null
    notice.value = null
    logHead = undefined
    unsubscribe = window.api.onRepoChanged((changed) => {
      if (changed === path.value) void refresh()
    })
    // 先监听再读取，否则两者之间发生的改动会漏掉
    try {
      await window.api.watchRepo(repo)
    } catch (e) {
      error.value = errorMessage(e)
    }
    await refresh()
  }

  function close(): void {
    unsubscribe?.()
    unsubscribe = null
    path.value = null
    void window.api.watchRepo(null)
  }

  return {
    path,
    tab,
    changes,
    branches,
    error,
    notice,
    changeTarget,
    changeVersion,
    commits,
    hasMoreCommits,
    loadingCommits,
    commitDetail,
    commitTarget,
    fetching,
    open,
    close,
    refresh,
    selectChange,
    selectCommit,
    selectCommitFile,
    loadMoreCommits,
    fetchRemote,
    pullRemote,
    cancelFetch
  }
})
