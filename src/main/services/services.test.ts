import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readStatus, runGit } from './git'
import { inspectProject, ProjectService } from './projects'
import { scanRoot } from './scanner'
import { isWithin, normalizeTags, Store } from './store'
import { detectTech } from './tech'

// 放在项目内：不往系统临时目录写
const tmpBase = resolve('.tmp-test')
let tmp: string

const touch = (...segments: string[]): void => {
  const file = join(tmp, ...segments)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, 'x')
}

const dir = (...segments: string[]): string => join(tmp, ...segments)

async function commit(cwd: string, message: string): Promise<void> {
  await runGit(cwd, ['add', '-A'])
  await runGit(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', message])
}

beforeAll(() => {
  mkdirSync(tmpBase, { recursive: true })
  tmp = mkdtempSync(join(tmpBase, 'run-'))
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('readStatus（真实 git）', () => {
  it('尚无提交的仓库', async () => {
    const repo = dir('空仓库')
    mkdirSync(repo)
    await runGit(repo, ['init', '-b', 'main'])
    const status = await readStatus(repo)
    expect(status).toMatchObject({ branch: 'main', head: null, lastCommit: null })
  })

  it('中文路径、重命名和未跟踪文件', async () => {
    const repo = dir('中文 仓库')
    mkdirSync(repo)
    await runGit(repo, ['init', '-b', 'main'])
    writeFileSync(join(repo, '旧文件.txt'), 'hello\n'.repeat(20))
    await commit(repo, '第一次提交')

    await runGit(repo, ['mv', '旧文件.txt', '新文件.txt'])
    writeFileSync(join(repo, '未跟踪 文件.txt'), 'x')

    const status = await readStatus(repo)
    expect(status).toMatchObject({ branch: 'main', staged: 1, unstaged: 0, untracked: 1 })
    expect(status.lastCommit?.subject).toBe('第一次提交')
    expect(status.lastCommit?.time).toBeGreaterThan(0)
  })

  it('领先和落后上游', async () => {
    const remote = dir('remote.git')
    mkdirSync(remote)
    await runGit(remote, ['init', '--bare', '-b', 'main'])
    const repo = dir('带上游')
    mkdirSync(repo)
    await runGit(repo, ['init', '-b', 'main'])
    await runGit(repo, ['remote', 'add', 'origin', remote])
    writeFileSync(join(repo, 'a.txt'), '1')
    await commit(repo, 'one')
    await runGit(repo, ['push', '-u', 'origin', 'main'])
    writeFileSync(join(repo, 'a.txt'), '2')
    await commit(repo, 'two')

    const status = await readStatus(repo)
    expect(status).toMatchObject({ upstream: 'origin/main', ahead: 1, behind: 0 })
  })
})

describe('scanRoot', () => {
  it('识别项目，跳过依赖目录和纯素材目录，并能进入容器目录', async () => {
    const root = 'scan-root'
    touch(root, 'vue-app', 'package.json')
    touch(root, 'vue-app', 'node_modules', 'dep', 'package.json')
    touch(root, 'plain-html', 'index.html')
    touch(root, '素材', 'a.png')
    touch(root, 'container', 'nested', 'go.mod')
    touch(root, '.hidden', 'package.json')
    touch(root, 'too', 'deep', 'for', 'scan', 'package.json')

    const found = (await scanRoot(dir(root))).map((p) => p.slice(dir(root).length + 1))
    expect(found.sort()).toEqual([join('container', 'nested'), 'plain-html', 'vue-app'])
  })

  it('根目录的零散脚本不会吞掉子项目，强标记才会', async () => {
    touch('loose-root', 'tool.js')
    touch('loose-root', 'child', 'package.json')
    expect(await scanRoot(dir('loose-root'))).toEqual([dir('loose-root', 'child')])

    touch('strong-root', 'package.json')
    touch('strong-root', 'child', 'package.json')
    expect(await scanRoot(dir('strong-root'))).toEqual([dir('strong-root')])
  })

  it('根目录不存在时抛错', async () => {
    await expect(scanRoot(dir('不存在'))).rejects.toThrow()
  })
})

describe('detectTech', () => {
  it('从依赖识别前端技术栈', () => {
    const pkg = { dependencies: { vue: '3' }, devDependencies: { electron: '1', vite: '6' } }
    expect(detectTech(['package.json'], pkg)).toEqual(['Electron', 'Vue', 'Vite'])
  })

  it('没有识别出的依赖时显示 Node.js', () => {
    expect(detectTech(['package.json'], { dependencies: { lodash: '1' } })).toEqual(['Node.js'])
  })

  it('从文件名识别其他语言和纯静态页面', () => {
    expect(detectTech(['main.py'], null)).toEqual(['Python'])
    expect(detectTech(['index.html'], null)).toEqual(['HTML/JS'])
    expect(detectTech(['readme.md'], null)).toEqual([])
  })
})

describe('Store', () => {
  it('持久化配置，并按不区分大小写的路径去重', () => {
    const file = dir('store-a', 'store.json')
    const store = new Store(file)
    store.addRoot('E:\\Code')
    store.addRoot('e:\\code\\')
    store.setFavorite('E:\\Code\\App', true)
    store.setTags('E:\\Code\\App', [' a ', 'a', '', 'b'])

    const reloaded = new Store(file)
    expect(reloaded.config.roots).toEqual(['E:\\Code'])
    expect(reloaded.metaOf('e:\\code\\app')).toEqual({ favorite: true, tags: ['a', 'b'] })
  })

  it('配置损坏时保留原文件并从空配置开始', () => {
    const folder = dir('store-b')
    mkdirSync(folder)
    const file = join(folder, 'store.json')
    writeFileSync(file, '{ 不是 json')

    expect(new Store(file).config.roots).toEqual([])
    expect(readdirSync(folder).some((n) => n.startsWith('store.json.corrupt-'))).toBe(true)
  })

  it('手动添加会取消隐藏', () => {
    const store = new Store(dir('store-c', 'store.json'))
    store.hide('E:\\p')
    store.addManual('E:\\p')
    expect(store.config.hidden).toEqual([])
    expect(store.config.manual).toEqual(['E:\\p'])
  })

  it('isWithin 按路径段比较，不区分大小写', () => {
    expect(isWithin('E:\\code\\app', 'e:\\CODE')).toBe(true)
    expect(isWithin('E:\\code', 'E:\\code\\')).toBe(true)
    expect(isWithin('E:\\code-old\\app', 'E:\\code')).toBe(false)
    expect(isWithin('E:\\code\\app', 'E:\\')).toBe(true)
  })

  it('规范化标签：去空白、去重、限制长度和数量', () => {
    expect(normalizeTags([' x ', 'x', ''])).toEqual(['x'])
    expect(normalizeTags(['a'.repeat(30)])[0]).toHaveLength(20)
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(10)
  })
})

describe('ProjectService', () => {
  it('汇总扫描结果和手动项目，隐藏的项目不显示但仍可恢复', async () => {
    touch('svc-root', 'one', 'package.json')
    touch('svc-root', 'two', 'index.html')
    touch('svc-manual', 'readme.md')

    const store = new Store(dir('svc-store', 'store.json'))
    store.addRoot(dir('svc-root'))
    store.addManual(dir('svc-manual'))
    store.hide(dir('svc-root', 'two'))

    const service = new ProjectService(store)
    const snapshot = await service.snapshot()

    expect(snapshot.projects.map((p) => p.name).sort()).toEqual(['one', 'svc-manual'])
    expect(service.isKnown(dir('svc-root', 'two'))).toBe(true)
    expect(service.isKnown(dir('别的目录'))).toBe(false)
  })

  it('排除目录跳过其下的扫描结果，手动添加的项目不受影响，移除后恢复', async () => {
    touch('ex-root', 'keep', 'package.json')
    touch('ex-root', 'keep-old', 'package.json')
    touch('ex-root', 'skip', 'a', 'package.json')
    touch('ex-root', 'skip', 'b', 'package.json')

    const store = new Store(dir('ex-store', 'store.json'))
    store.addRoot(dir('ex-root'))
    store.addExcluded(dir('ex-root', 'skip'))
    store.addExcluded(dir('ex-root', 'keep'))
    store.removeExcluded(dir('ex-root', 'keep'))
    store.addManual(dir('ex-root', 'skip', 'b'))

    const service = new ProjectService(store)
    const names = async (): Promise<string[]> =>
      (await service.snapshot()).projects.map((p) => p.name).sort()

    expect(await names()).toEqual(['b', 'keep', 'keep-old'])
    expect(service.isKnown(dir('ex-root', 'skip', 'a'))).toBe(false)

    store.removeExcluded(dir('ex-root', 'skip'))
    expect(await names()).toEqual(['a', 'b', 'keep', 'keep-old'])
    expect(new Store(dir('ex-store', 'store.json')).config.excluded).toEqual([])
  })

  it('根目录失效时记录错误，不影响其他项目', async () => {
    touch('svc2-manual', 'index.html')
    const store = new Store(dir('svc2-store', 'store.json'))
    store.addRoot(dir('已删除的根目录'))
    store.addManual(dir('svc2-manual'))

    const snapshot = await new ProjectService(store).snapshot()
    expect(snapshot.scanErrors).toHaveLength(1)
    expect(snapshot.projects).toHaveLength(1)
  })
})

describe('inspectProject', () => {
  it('路径不存在时标记 missing', async () => {
    const project = await inspectProject(dir('消失的项目'))
    expect(project.missing).toBe(true)
  })

  it('git 命令失败时返回错误而不是抛出', async () => {
    const repo = dir('坏仓库')
    mkdirSync(repo)
    // .git 文件指向不存在的位置时 git 直接报错，不会向上找到外层仓库
    writeFileSync(join(repo, '.git'), 'gitdir: 不存在的位置')
    const project = await inspectProject(repo)
    expect(project.isGit).toBe(true)
    expect(project.git).toBeNull()
    expect(project.gitError).toContain('.git 无效')
  })
})
