import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readChanges, runGit } from './git'
import { parseBranches, parseChanges, parseLog, parseNameStatus } from './gitParse'
import {
  assertHash,
  assertRepoPath,
  listBranches,
  readCommit,
  readDiff,
  readLog,
  switchBranch
} from './gitOps'
import { describeRemoteError, runFetch } from './remoteOps'
import { RepoQueue } from './repoQueue'
import { isRelevantChange } from './repoWatcher'

const tmpBase = resolve('.tmp-test')
let tmp: string
let counter = 0

async function newRepo(name = `repo-${counter++}`): Promise<string> {
  const repo = join(tmp, name)
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-b', 'main'])
  await runGit(repo, ['config', 'user.name', 't'])
  await runGit(repo, ['config', 'user.email', 't@t'])
  return repo
}

const write = (repo: string, file: string, content = 'x\n'): void => {
  const full = join(repo, file)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

const stage = (repo: string, ...paths: string[]): Promise<string> =>
  runGit(repo, ['add', '-A', '--', ...paths])

async function commitAll(repo: string, message: string): Promise<void> {
  await runGit(repo, ['add', '-A'])
  await runGit(repo, ['commit', '-m', message])
}

/** 带本地裸仓库上游的仓库 */
async function repoWithRemote(): Promise<{ repo: string; remote: string }> {
  const remote = join(tmp, `remote-${counter++}.git`)
  mkdirSync(remote)
  await runGit(remote, ['init', '--bare', '-b', 'main'])
  const repo = await newRepo()
  await runGit(repo, ['remote', 'add', 'origin', remote])
  write(repo, 'a.txt', '1\n')
  await commitAll(repo, 'one')
  await runGit(repo, ['push', '-u', 'origin', 'main'])
  return { repo, remote }
}

async function clone(remote: string): Promise<string> {
  const dir = join(tmp, `clone-${counter++}`)
  await runGit(tmp, ['clone', remote, dir])
  await runGit(dir, ['config', 'user.name', 't'])
  await runGit(dir, ['config', 'user.email', 't@t'])
  return dir
}

beforeAll(() => {
  mkdirSync(tmpBase, { recursive: true })
  tmp = mkdtempSync(join(tmpBase, 'ops-'))
})

afterAll(() => {
  // 被取消的 git 子进程可能还占着目录一小会儿
  rmSync(tmp, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 })
})

describe('解析', () => {
  it('parseChanges 取出含空格的路径、重命名原路径和未跟踪文件', () => {
    const output = [
      '# branch.head main',
      '1 M. N... 100644 100644 100644 a b 带 空格.txt',
      '1 .D N... 100644 100644 000000 a b 删除.txt',
      '1 MM N... 100644 100644 100644 a b 两边.txt',
      '2 R. N... 100644 100644 100644 a b R100 新 名.txt',
      '旧 名.txt',
      'u UU N... 100644 100644 100644 100644 a b c 冲突 文件.txt',
      '? 未跟踪 文件.txt',
      ''
    ].join('\0')
    const { staged, unstaged, conflicted } = parseChanges(output)
    expect(staged).toEqual([
      { path: '带 空格.txt', origPath: null, state: 'modified' },
      { path: '两边.txt', origPath: null, state: 'modified' },
      { path: '新 名.txt', origPath: '旧 名.txt', state: 'renamed' }
    ])
    expect(unstaged).toEqual([
      { path: '删除.txt', origPath: null, state: 'deleted' },
      { path: '两边.txt', origPath: null, state: 'modified' },
      { path: '未跟踪 文件.txt', origPath: null, state: 'untracked' }
    ])
    expect(conflicted).toEqual([{ path: '冲突 文件.txt', origPath: null, state: 'conflicted' }])
  })

  it('parseLog 解析多条记录、父提交和引用', () => {
    const log = parseLog(
      'aaa\0p1 p2\0作者\0e@x\x001700000000\0合并\0HEAD -> main, tag: v1\x1e\nbbb\0\0作者\0e@x\x001700000000\0根提交\0\x1e\n'
    )
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ parents: ['p1', 'p2'], refs: ['HEAD -> main', 'tag: v1'] })
    expect(log[1]).toMatchObject({ parents: [], refs: [], subject: '根提交' })
  })

  it('parseNameStatus 处理重命名占三个 token', () => {
    expect(parseNameStatus('M\0a.txt\0R100\0旧.txt\0新.txt\0A\0b.txt\0')).toEqual([
      { path: 'a.txt', origPath: null, state: 'modified' },
      { path: '新.txt', origPath: '旧.txt', state: 'renamed' },
      { path: 'b.txt', origPath: null, state: 'added' }
    ])
  })

  it('parseBranches 解析领先落后、已删除上游并跳过 origin/HEAD', () => {
    const branches = parseBranches(
      [
        'refs/heads/main\0abc\0origin/main\0ahead 2, behind 1\x001700000000\0*\0主题',
        'refs/heads/old\0abd\0origin/old\0gone\x001700000000\0 \0主题',
        'refs/remotes/origin/HEAD\0abc\0\0\x001700000000\0 \0主题',
        'refs/remotes/origin/main\0abc\0\0\x001700000000\0 \0主题',
        ''
      ].join('\n')
    )
    expect(branches.map((b) => b.name)).toEqual(['main', 'old', 'origin/main'])
    expect(branches[0]).toMatchObject({ current: true, ahead: 2, behind: 1, kind: 'local' })
    expect(branches[1].gone).toBe(true)
    expect(branches[2].kind).toBe('remote')
  })

  it('describeRemoteError 给出中文提示并保留原始信息', () => {
    expect(describeRemoteError('hint: x\nfatal: Authentication failed for url\n')).toContain('认证失败')
    expect(describeRemoteError('fatal: 其他错误\n')).toBe('fatal: 其他错误')
  })
})

describe('输入校验', () => {
  it('assertRepoPath 拒绝越界、绝对路径和 .git', () => {
    const cwd = 'E:\\repo'
    expect(assertRepoPath(cwd, 'src/中文 文件.ts')).toBe('src/中文 文件.ts')
    for (const bad of ['../x', 'a/../../x', 'E:\\other\\x', '.git/config', '.GIT/config', '', 1]) {
      expect(() => assertRepoPath(cwd, bad)).toThrow()
    }
  })

  it('assertHash 只接受十六进制提交号', () => {
    expect(assertHash('abc1234')).toBe('abc1234')
    for (const bad of ['--all', 'HEAD', 'abc', 'abc1234;rm', null]) {
      expect(() => assertHash(bad)).toThrow()
    }
  })
})

describe('只读', () => {
  it('所有读取操作都不改动仓库', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt', '1\n')
    await commitAll(repo, 'init')
    write(repo, 'a.txt', '2\n')
    await stage(repo, 'a.txt')
    write(repo, 'a.txt', '3\n')
    write(repo, 'new.txt')

    const fingerprint = (): unknown => ({
      index: readFileSync(join(repo, '.git/index')).toString('base64'),
      indexMtime: statSync(join(repo, '.git/index')).mtimeMs,
      head: readFileSync(join(repo, '.git/HEAD'), 'utf8'),
      main: readFileSync(join(repo, '.git/refs/heads/main'), 'utf8'),
      file: readFileSync(join(repo, 'a.txt'), 'utf8')
    })
    const before = fingerprint()

    const [latest] = await readLog(repo, 0, 10)
    await readChanges(repo)
    await listBranches(repo)
    await readCommit(repo, latest.hash)
    await readDiff(repo, { kind: 'staged', path: 'a.txt', origPath: null })
    await readDiff(repo, { kind: 'unstaged', path: 'a.txt', origPath: null })
    await readDiff(repo, { kind: 'unstaged', path: 'new.txt', origPath: null })

    expect(fingerprint()).toEqual(before)
  })
})

describe('读取变更', () => {
  it('中文、空格和像通配符的文件名都能列出', async () => {
    const repo = await newRepo()
    write(repo, '中文 文件.txt')
    write(repo, 'a[1].txt')
    await stage(repo, '中文 文件.txt')

    const changes = await readChanges(repo)
    expect(changes.staged.map((f) => f.path)).toEqual(['中文 文件.txt'])
    expect(changes.unstaged.map((f) => f.path)).toEqual(['a[1].txt'])
  })

  it('重命名记录原路径', async () => {
    const repo = await newRepo()
    write(repo, 'old.txt', 'line\n'.repeat(20))
    await commitAll(repo, 'init')
    await runGit(repo, ['mv', 'old.txt', 'new.txt'])
    expect((await readChanges(repo)).staged[0]).toMatchObject({
      path: 'new.txt',
      origPath: 'old.txt',
      state: 'renamed'
    })
  })
})

describe('readDiff', () => {
  it('未暂存、已暂存、新增和删除各取正确的两边', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt', 'v1\n')
    write(repo, 'del.txt', 'bye\n')
    await commitAll(repo, 'init')

    write(repo, 'a.txt', 'v2\n')
    await stage(repo, 'a.txt')
    write(repo, 'a.txt', 'v3\n')
    rmSync(join(repo, 'del.txt'))
    write(repo, 'new.txt', 'new\n')

    const of = (kind: 'staged' | 'unstaged', path: string) =>
      readDiff(repo, { kind, path, origPath: null })

    expect(await of('staged', 'a.txt')).toMatchObject({ original: 'v1\n', modified: 'v2\n' })
    expect(await of('unstaged', 'a.txt')).toMatchObject({ original: 'v2\n', modified: 'v3\n' })
    expect(await of('unstaged', 'del.txt')).toMatchObject({ original: 'bye\n', modified: '' })
    expect(await of('unstaged', 'new.txt')).toMatchObject({ original: '', modified: 'new\n' })
  })

  it('中文文件名：未跟踪、已暂存、已删除都能取到内容', async () => {
    const repo = await newRepo()
    write(repo, '旧 文件.txt', '旧\n')
    await commitAll(repo, 'init')

    write(repo, '图片 说明.txt', '新\n')
    expect(await readDiff(repo, { kind: 'unstaged', path: '图片 说明.txt', origPath: null })).toMatchObject({
      original: '',
      modified: '新\n'
    })
    await stage(repo, '图片 说明.txt')
    expect(await readDiff(repo, { kind: 'staged', path: '图片 说明.txt', origPath: null })).toMatchObject({
      original: '',
      modified: '新\n'
    })

    rmSync(join(repo, '旧 文件.txt'))
    expect(await readDiff(repo, { kind: 'unstaged', path: '旧 文件.txt', origPath: null })).toMatchObject({
      original: '旧\n',
      modified: ''
    })
  })

  it('尚无提交时已暂存文件的原内容为空', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt', 'v1\n')
    await stage(repo, 'a.txt')
    expect(await readDiff(repo, { kind: 'staged', path: 'a.txt', origPath: null })).toMatchObject({
      original: '',
      modified: 'v1\n'
    })
  })

  it('提交的 diff：根提交和重命名', async () => {
    const repo = await newRepo()
    write(repo, 'old.txt', 'line\n'.repeat(20))
    await commitAll(repo, 'root')
    await runGit(repo, ['mv', 'old.txt', 'new.txt'])
    await runGit(repo, ['commit', '-m', 'rename'])

    const [second, first] = await readLog(repo, 0, 2)
    const rootDetail = await readCommit(repo, first.hash)
    expect(rootDetail.files).toEqual([{ path: 'old.txt', origPath: null, state: 'added' }])

    const detail = await readCommit(repo, second.hash)
    expect(detail.files).toEqual([{ path: 'new.txt', origPath: 'old.txt', state: 'renamed' }])

    const diff = await readDiff(repo, {
      kind: 'commit',
      hash: second.hash,
      parent: first.hash,
      path: 'new.txt',
      origPath: 'old.txt'
    })
    expect(diff.original).toBe(diff.modified)
    expect(diff.original).toContain('line')
  })

  it('二进制和过大的文件不返回内容', async () => {
    const repo = await newRepo()
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 0, 2]))
    write(repo, 'big.txt', 'x'.repeat(3 * 1024 * 1024))
    const of = (path: string) => readDiff(repo, { kind: 'unstaged', path, origPath: null })
    expect(await of('bin.dat')).toEqual({ original: '', modified: '', binary: true, tooLarge: false })
    expect(await of('big.txt')).toEqual({ original: '', modified: '', binary: false, tooLarge: true })

    await stage(repo, 'big.txt')
    expect(await readDiff(repo, { kind: 'staged', path: 'big.txt', origPath: null })).toMatchObject({
      tooLarge: true
    })
  })
})

describe('历史', () => {
  it('分页读取，尚无提交时返回空；多行提交信息完整保留', async () => {
    const repo = await newRepo()
    expect(await readLog(repo, 0, 10)).toEqual([])
    for (const n of [1, 2, 3]) {
      write(repo, 'a.txt', `${n}\n`)
      await commitAll(repo, `c${n}`)
    }
    expect((await readLog(repo, 0, 2)).map((c) => c.subject)).toEqual(['c3', 'c2'])
    expect((await readLog(repo, 2, 2)).map((c) => c.subject)).toEqual(['c1'])

    write(repo, 'a.txt', '4\n')
    await runGit(repo, ['add', '-A'])
    await runGit(repo, ['commit', '-m', '标题\n\n正文 "引号"'])
    const [latest] = await readLog(repo, 0, 1)
    expect((await readCommit(repo, latest.hash)).message).toBe('标题\n\n正文 "引号"')
  })

  it('合并提交与第一父提交比较', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt')
    await commitAll(repo, 'base')
    await runGit(repo, ['switch', '-c', 'side'])
    write(repo, 'side.txt')
    await commitAll(repo, 'side')
    await runGit(repo, ['switch', 'main'])
    write(repo, 'main.txt')
    await commitAll(repo, 'main')
    await runGit(repo, ['merge', '--no-ff', '-m', 'merge', 'side'])

    const [merge] = await readLog(repo, 0, 1)
    const detail = await readCommit(repo, merge.hash)
    expect(detail.parents).toHaveLength(2)
    expect(detail.files.map((f) => f.path)).toEqual(['side.txt'])
  })
})

describe('分支列表', () => {
  it('列出本地和远程分支，标记当前分支和上游', async () => {
    const { repo } = await repoWithRemote()
    await runGit(repo, ['switch', '-c', 'feature/中文'])
    const branches = await listBranches(repo)
    expect(branches.find((b) => b.current)?.name).toBe('feature/中文')
    expect(branches.find((b) => b.name === 'main')).toMatchObject({
      kind: 'local',
      upstream: 'origin/main'
    })
    expect(branches.find((b) => b.name === 'origin/main')?.kind).toBe('remote')
  })
})

describe('远程地址', () => {
  it('从真实仓库读取，令牌不出现在结果里', async () => {
    const repo = await newRepo()
    await runGit(repo, ['remote', 'add', 'upstream', 'git@github.com:a/up.git'])
    await runGit(repo, ['remote', 'add', 'origin', 'https://ghp_secret@github.com/a/b.git'])
    const { status } = await readChanges(repo)
    expect(status.remotes).toEqual([
      { name: 'origin', url: 'https://github.com/a/b.git' },
      { name: 'upstream', url: 'git@github.com:a/up.git' }
    ])
    expect(JSON.stringify(status)).not.toContain('ghp_secret')
  })

  it('没有远程时为空', async () => {
    expect((await readChanges(await newRepo())).status.remotes).toEqual([])
  })
})

describe('切换分支', () => {
  const current = async (repo: string): Promise<string | undefined> =>
    (await listBranches(repo)).find((b) => b.current)?.name

  it('切换本地分支，含中文名；不相关的未提交改动跟着走', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt', '1\n')
    await commitAll(repo, 'init')
    await runGit(repo, ['branch', 'feature/中文'])

    write(repo, 'b.txt', '未跟踪\n')
    write(repo, 'a.txt', '未提交\n')
    await switchBranch(repo, 'feature/中文', 'local')

    expect(await current(repo)).toBe('feature/中文')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('未提交\n')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('未跟踪\n')
  })

  it('会覆盖工作区改动时拒绝切换，分支和改动都不变', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt', '1\n')
    await commitAll(repo, 'init')
    await runGit(repo, ['switch', '-c', 'other'])
    write(repo, 'a.txt', '2\n')
    await commitAll(repo, 'change')
    await runGit(repo, ['switch', 'main'])

    write(repo, 'a.txt', '本地改动\n')
    await expect(switchBranch(repo, 'other', 'local')).rejects.toThrow('改动都还在')
    expect(await current(repo)).toBe('main')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('本地改动\n')
  })

  it('远程分支签出为跟踪分支', async () => {
    const { repo, remote } = await repoWithRemote()
    await runGit(repo, ['switch', '-c', 'topic'])
    await runGit(repo, ['push', 'origin', 'topic'])

    const other = await clone(remote)
    await switchBranch(other, 'origin/topic', 'remote')
    expect((await listBranches(other)).find((b) => b.current)).toMatchObject({
      name: 'topic',
      upstream: 'origin/topic'
    })
  })

  it('拒绝选项形式、非法和不存在的分支名；不会切到提交号', async () => {
    const repo = await newRepo()
    write(repo, 'a.txt')
    await commitAll(repo, 'init')
    const hash = (await runGit(repo, ['rev-parse', 'HEAD'])).trim()

    for (const bad of ['--force', '-d', 'a b', 'x..y', '', 1]) {
      await expect(switchBranch(repo, bad, 'local')).rejects.toThrow('分支名无效')
    }
    await expect(switchBranch(repo, '不存在', 'local')).rejects.toThrow()
    await expect(switchBranch(repo, hash, 'local')).rejects.toThrow()
    expect(await current(repo)).toBe('main')
  })
})

describe('Fetch', () => {
  it('只更新远程跟踪分支，落后数变化，本地分支和工作区不动', async () => {
    const { repo, remote } = await repoWithRemote()
    const other = await clone(remote)
    write(other, 'a.txt', '2\n')
    await commitAll(other, 'two')
    await runGit(other, ['push'])

    write(repo, 'a.txt', '本地改动\n')
    const headBefore = await runGit(repo, ['rev-parse', 'HEAD'])

    const lines: string[] = []
    const result = await runFetch(repo, { onProgress: (l) => lines.push(l) })
    expect(result).toEqual({ ok: true, cancelled: false, message: '' })
    expect(lines.length).toBeGreaterThan(0)

    expect((await readChanges(repo)).status.behind).toBe(1)
    expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('本地改动\n')
  })

  it('没有远程时返回错误而不是抛出', async () => {
    const repo = await newRepo()
    expect(await runFetch(repo)).toMatchObject({ ok: false, message: '没有配置远程仓库' })
  })

  it('取消时立即返回，不等子进程结束', async () => {
    const { repo } = await repoWithRemote()
    // 本地传输经由 shell 启动 upload-pack，用它模拟卡住的远程
    await runGit(repo, ['config', 'remote.origin.uploadpack', 'sleep 8; git-upload-pack'])

    const controller = new AbortController()
    const started = Date.now()
    const pending = runFetch(repo, { signal: controller.signal })
    setTimeout(() => controller.abort(), 800)
    expect(await pending).toMatchObject({ ok: false, cancelled: true })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('准备阶段取消也生效，不会真的执行', async () => {
    const { repo, remote } = await repoWithRemote()
    const other = await clone(remote)
    write(other, 'a.txt', '2\n')
    await commitAll(other, 'should not arrive')
    await runGit(other, ['push'])

    const controller = new AbortController()
    const pending = runFetch(repo, { signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ cancelled: true })
    expect((await readChanges(repo)).status.behind).toBe(0)
  })

  it('已取消的信号不会启动操作', async () => {
    const { repo } = await repoWithRemote()
    const controller = new AbortController()
    controller.abort()
    expect(await runFetch(repo, { signal: controller.signal })).toMatchObject({ cancelled: true })
  })
})

describe('RepoQueue', () => {
  it('同一仓库依次执行，失败不阻塞后续；不同仓库可并行', async () => {
    const queue = new RepoQueue()
    const events: string[] = []
    const task = (name: string, ms: number, fail = false) => async () => {
      events.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, ms))
      events.push(`end ${name}`)
      if (fail) throw new Error(name)
      return name
    }
    const a = queue.run('E:\\repo', task('a', 30, true))
    const b = queue.run('e:\\REPO', task('b', 1))
    const c = queue.run('E:\\other', task('c', 1))
    await expect(a).rejects.toThrow('a')
    expect(await b).toBe('b')
    expect(await c).toBe('c')
    expect(events.indexOf('end a')).toBeLessThan(events.indexOf('start b'))
    expect(events.indexOf('start c')).toBeLessThan(events.indexOf('end a'))
  })
})

describe('isRelevantChange', () => {
  it('过滤依赖目录、对象库和锁文件', () => {
    for (const file of ['src\\a.ts', '.git\\HEAD', '.git\\index', '.git\\refs\\heads\\main', null]) {
      expect(isRelevantChange(file)).toBe(true)
    }
    for (const file of ['node_modules\\x\\y.js', '.git\\objects\\ab\\cd', '.git\\index.lock', 'a\\b.lock']) {
      expect(isRelevantChange(file)).toBe(false)
    }
  })
})
