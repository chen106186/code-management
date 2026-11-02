import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  Branch,
  ChangedFile,
  CommitDetail,
  CommitSummary,
  DiffTarget,
  RemoteKind,
  RepoChanges
} from '@shared/repo'
import { errorMessage } from '@renderer/lib/errors'

const LOG_PAGE = 100

export type RepoTab = 'changes' | 'history' | 'branches'
type ChangeTarget = Extract<DiffTarget, { kind: 'staged' | 'unstaged' }>

const REMOTE_LABEL: Record<RemoteKind, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push' }

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
  const commitMessage = ref('')
  const committing = ref(false)

  const commits = ref<CommitSummary[]>([])
  const hasMoreCommits = ref(false)
  const loadingCommits = ref(false)
  const commitDetail = ref<CommitDetail | null>(null)
  const commitTarget = ref<DiffTarget | null>(null)

  const remote = ref<{ kind: RemoteKind; opId: string; line: string } | null>(null)

  let refreshId = 0
  let logHead: string | null | undefined
  let unsubscribe: (() => void) | null = null

  /** 选中的文件被暂存或取消暂存后跟到另一侧；已不存在则取消选中 */
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

  /** 执行写操作后总是刷新：失败时仓库也可能已部分变化 */
  async function act(action: (repo: string) => Promise<unknown>): Promise<boolean> {
    const repo = path.value
    if (!repo) return false
    let ok = true
    try {
      await action(repo)
      error.value = null
    } catch (e) {
      error.value = errorMessage(e)
      ok = false
    }
    await refresh()
    return ok
  }

  const stage = (files: ChangedFile[]): Promise<boolean> =>
    act((repo) => window.api.stage(repo, files.map((f) => f.path)))

  // 重命名要连原路径一起恢复，否则会留下一条已暂存的删除
  const unstage = (files: ChangedFile[]): Promise<boolean> =>
    act((repo) =>
      window.api.unstage(
        repo,
        files.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]))
      )
    )

  async function commit(): Promise<void> {
    committing.value = true
    const ok = await act((repo) => window.api.commit(repo, commitMessage.value))
    committing.value = false
    if (ok) {
      commitMessage.value = ''
      notice.value = '提交成功'
    }
  }

  const switchBranch = (branch: Branch): Promise<boolean> =>
    act((repo) => window.api.switchBranch(repo, branch.name, branch.kind))

  const createBranch = (name: string): Promise<boolean> =>
    act((repo) => window.api.createBranch(repo, name))

  const deleteBranch = (name: string): Promise<boolean> =>
    act((repo) => window.api.deleteBranch(repo, name))

  async function runRemote(kind: RemoteKind): Promise<void> {
    const repo = path.value
    if (!repo || remote.value) return
    const opId = `${kind}-${Date.now()}`
    remote.value = { kind, opId, line: '' }
    error.value = null
    notice.value = null
    const off = window.api.onRemoteProgress((progress) => {
      if (remote.value?.opId === progress.opId) remote.value.line = progress.line
    })
    try {
      const result = await window.api.runRemote(repo, kind, opId)
      if (result.cancelled) notice.value = `${REMOTE_LABEL[kind]} 已取消`
      else if (result.ok) notice.value = `${REMOTE_LABEL[kind]} 完成`
      else error.value = `${REMOTE_LABEL[kind]} 失败：${result.message}`
    } catch (e) {
      error.value = errorMessage(e)
    } finally {
      off()
      remote.value = null
    }
    await refresh()
  }

  function cancelRemote(): void {
    if (remote.value) void window.api.cancelRemote(remote.value.opId)
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
    commitMessage.value = ''
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
    commitMessage,
    committing,
    commits,
    hasMoreCommits,
    loadingCommits,
    commitDetail,
    commitTarget,
    remote,
    open,
    close,
    refresh,
    stage,
    unstage,
    commit,
    selectChange,
    selectCommit,
    selectCommitFile,
    loadMoreCommits,
    switchBranch,
    createBranch,
    deleteBranch,
    runRemote,
    cancelRemote
  }
})
